import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { median, type Scored } from "./metrics";
import { mapPool } from "./util";
import {
  channelsByIds,
  recentVideoIds,
  searchShorts,
  videoDetails,
  type ChannelInfo,
  type RawVideo,
} from "./youtube";
import { trackedClient } from "./usage";

const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

// ---------------------------------------------------------------- profile

export const Profile = z.object({
  summary: z.string().describe("이 채널이 어떤 채널인지 2~3문장. 소재, 영상 형식, 주 시청자"),
  niche: z.string().describe("한 줄 분류 (예: 'K-pop 아이돌 팬 편집 쇼츠')"),
  content_formats: z.array(z.string()).describe("반복되는 영상 형식/소재 패턴 3~5개"),
  core_terms: z
    .array(z.string())
    .describe(
      "이 채널의 소재를 식별하는 고유명사·핵심어 5~15개. 그룹/인물/작품/게임명과 표기 변형(한글, 영문, 줄임말, 멤버·캐릭터 이름). '웃긴','쇼츠','모음'처럼 어느 채널에나 붙는 일반어는 절대 넣지 않음",
    ),
  search_queries: z
    .array(z.string())
    .describe("비슷한 쇼츠 채널을 찾기 위한 유튜브 검색어 5개. 서로 다른 각도(소재, 인물/주제, 형식)로. 내 채널명은 제외"),
});
export type Profile = z.infer<typeof Profile>;

export function topHashtags(videos: Scored[], n = 25) {
  const count = new Map<string, number>();
  for (const v of videos) for (const h of new Set([...(v.hashtags ?? []), ...(v.tags ?? [])])) count.set(h, (count.get(h) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, n).map(([tag, videos]) => ({ tag, videos }));
}

export async function profileChannel(channel: ChannelInfo, videos: Scored[]): Promise<Profile> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY가 .env.local에 설정되지 않았습니다.");
  const byViews = [...videos].sort((a, b) => b.views - a.views);
  const recent = [...videos].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const pick = (v: Scored) => ({ title: v.title, views: v.views, sec: v.durationSec, date: v.publishedAt.slice(0, 10) });

  const client = trackedClient("channel-profile");
  const res = await client.messages.parse({
    model: MODEL(),
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: zodOutputFormat(Profile) },
    system:
      "당신은 유튜브 채널 분석가입니다. 채널의 영상 제목·조회수·길이·해시태그만 보고 채널의 정체성을 파악합니다. 확인되는 사실만 말하고 추측하지 않습니다. 한국어로 답합니다.",
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          channel: { title: channel.title, subscribers: channel.subscribers, videoCount: channel.videoCount },
          top_by_views: byViews.slice(0, 25).map(pick),
          most_recent: recent.slice(0, 15).map(pick),
          frequent_hashtags_and_tags: topHashtags(videos),
        }),
      },
    ],
  });
  if (!res.parsed_output) throw new Error("채널 프로필을 만들지 못했습니다. 다시 시도해 주세요.");
  return res.parsed_output;
}

// ---------------------------------------------------------------- discovery

export type Candidate = {
  id: string;
  title: string;
  handle?: string;
  subscribers: number;
  videoCount: number;
  sizeRatio: number | null; // subscribers relative to mine
  sampleTitles: string[]; // recent uploads, not just the search hit
  relevance: number; // 0-100, LLM verdict on whether this is a real same-niche channel
  verdict: "dedicated" | "partial";
  reason: string;
  titleMatchPct: number; // % of recent videos whose title text mentions a core term
  hashtagOnlyPct: number; // % that mention a core term only via hashtags/tags
  shortsPct: number;
  uploads90d: number;
  medianViews: number;
};

export type Excluded = { id: string; title: string; subscribers: number; reason: string };

type Pool = { id: string; hits: number };

// The model sometimes echoes raw metric names; show readable text instead.
export const cleanReason = (r: string) =>
  r
    .replace(/\(?\s*titleMatchPct\s*[:=]?\s*(\d+)\s*\)?/g, "(제목 일치 $1%)")
    .replace(/\(?\s*hashtagOnlyPct\s*[:=]?\s*(\d+)\s*\)?/g, "(해시태그에만 $1%)");

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const stripHashtags = (t: string) => t.replace(/#[\p{L}\p{N}_]+/gu, " ");

export function matchStats(videos: RawVideo[], coreTerms: string[], now: number) {
  const terms = coreTerms.map(norm).filter((t) => t.length >= 2);
  let inTitle = 0;
  let metaOnly = 0;
  for (const v of videos) {
    const title = norm(stripHashtags(v.title));
    const hit = terms.some((t) => title.includes(t));
    if (hit) {
      inTitle++;
      continue;
    }
    const tags = [...(v.hashtags ?? []), ...(v.tags ?? [])].map(norm);
    if (terms.some((t) => tags.some((g) => g.includes(t)))) metaOnly++;
  }
  const n = videos.length || 1;
  return {
    titleMatchPct: Math.round((inTitle / n) * 100),
    hashtagOnlyPct: Math.round((metaOnly / n) * 100),
    shortsPct: Math.round((videos.filter((v) => v.format === "short").length / n) * 100),
    uploads90d: videos.filter((v) => now - Date.parse(v.publishedAt) < 90 * 86400_000).length,
    medianViews: Math.round(median(videos.map((v) => v.views))),
  };
}

const Verdicts = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      relevance: z.number().describe("0-100. 내 채널과 같은 소재를 꾸준히 다루는 정도"),
      verdict: z.enum(["dedicated", "partial", "unrelated"]),
      reason: z.string().describe("한 문장. 최근 제목에서 확인되는 근거를 인용"),
    }),
  ),
});

async function judge(profile: Profile, rows: { c: ChannelInfo; titles: string[]; s: ReturnType<typeof matchStats> }[]) {
  const client = trackedClient("channel-judge");
  const res = await client.messages.parse({
    model: MODEL(),
    max_tokens: 12000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: zodOutputFormat(Verdicts) },
    system: `당신은 유튜브 벤치마크 채널 선별 담당자입니다. 내 채널과 "같은 소재를 꾸준히 다루는 전용 채널"만 통과시킵니다.
- dedicated: 최근 영상 대부분이 내 채널과 같은 소재(같은 인물·그룹·작품 등)를 제목 본문에서 직접 다룸.
- partial: 같은 소재를 자주 다루지만 다른 소재도 상당수 섞여 있음.
- unrelated: 소재가 다르거나, 조회수를 노리고 해시태그·태그로만 소재를 끼워 넣었거나, 소재 언급이 일회성임.
판단은 제공된 제목과 지표(titleMatchPct: 제목 본문에 핵심어가 있는 비율, hashtagOnlyPct: 해시태그·태그에만 있는 비율)로만 하고, 제목에 없는 내용은 추측하지 않습니다. 모든 채널에 결과를 하나씩 반환합니다. reason에는 지표 변수명(titleMatchPct 등)을 쓰지 말고 "제목의 90%"처럼 풀어서 씁니다.`,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          my_channel: { niche: profile.niche, summary: profile.summary, formats: profile.content_formats, core_terms: profile.core_terms },
          candidates: rows.map(({ c, titles, s }) => ({
            id: c.id,
            name: c.title,
            subscribers: c.subscribers,
            ...s,
            recent_titles: titles,
          })),
        }),
      },
    ],
  });
  return new Map((res.parsed_output?.results ?? []).map((r) => [r.id, r]));
}

export async function findSimilarChannels(
  profile: Profile,
  region: string,
  me: ChannelInfo,
  myShortsPct: number,
): Promise<{ candidates: Candidate[]; excluded: Excluded[]; notes: string[]; stats: { pool: number; checked: number } }> {
  const notes: string[] = [];
  const now = Date.now();

  // 1) Candidate pool from searches (cheap pre-filter only; relevance is verified below).
  const found = new Map<string, Pool>();
  for (const q of profile.search_queries.slice(0, 5)) {
    try {
      for (const v of await searchShorts(q, region)) {
        if (v.channelId === me.id) continue;
        const e = found.get(v.channelId) ?? { id: v.channelId, hits: 0 };
        e.hits++;
        found.set(v.channelId, e);
      }
    } catch (e) {
      notes.push(`검색어 "${q}" 실패: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  const pool = [...found.values()].sort((a, b) => b.hits - a.hits).slice(0, 40);
  if (!pool.length) return { candidates: [], excluded: [], notes, stats: { pool: 0, checked: 0 } };

  const channels = (await channelsByIds(pool.map((p) => p.id))).filter(
    (c) => c.videoCount >= 10 && c.subscribers >= 300,
  );

  // 2) Look at what each channel actually uploads (last 30 videos), not at the search hit.
  const excluded: Excluded[] = [];
  const out = (c: ChannelInfo, reason: string) =>
    excluded.push({ id: c.id, title: c.title, subscribers: c.subscribers, reason });

  const analyzed = await mapPool(channels, 5, async (c) => {
    try {
      const videos = await videoDetails(await recentVideoIds(c.uploadsPlaylistId, 30));
      return { c, videos, s: matchStats(videos, profile.core_terms, now) };
    } catch {
      return null;
    }
  });

  const survivors: { c: ChannelInfo; titles: string[]; s: ReturnType<typeof matchStats> }[] = [];
  for (const a of analyzed) {
    if (!a) continue;
    const { c, videos, s } = a;
    if (videos.length < 5) out(c, "공개 영상이 너무 적음");
    else if (s.uploads90d === 0) out(c, "최근 90일간 업로드 없음");
    else if (myShortsPct >= 70 && s.shortsPct < 50) out(c, `쇼츠 비중이 낮음(${s.shortsPct}%)`);
    else if (s.titleMatchPct < 20)
      out(
        c,
        s.hashtagOnlyPct > s.titleMatchPct
          ? `핵심어가 제목엔 ${s.titleMatchPct}%뿐이고 해시태그·태그에만 ${s.hashtagOnlyPct}% 사용 (해시태그 의존)`
          : `최근 영상 제목에 핵심어가 ${s.titleMatchPct}%뿐 (소재 불일치)`,
      );
    else
      survivors.push({
        c,
        s,
        titles: [...videos]
          .sort((x, y) => y.publishedAt.localeCompare(x.publishedAt))
          .slice(0, 12)
          .map((v) => v.title.slice(0, 70)),
      });
  }

  // 3) A final semantic check on what's left.
  let verdicts = new Map<string, z.infer<typeof Verdicts>["results"][number]>();
  if (survivors.length) {
    try {
      verdicts = await judge(profile, survivors);
    } catch (e) {
      notes.push(`AI 판정에 실패해 지표 기준으로만 걸렀습니다: ${(e as Error).message.slice(0, 100)}`);
    }
  }

  const candidates: Candidate[] = [];
  for (const { c, titles, s } of survivors) {
    const v = verdicts.get(c.id);
    if (v && (v.verdict === "unrelated" || v.relevance < 60)) {
      out(c, cleanReason(v.reason) || "AI 판정: 같은 소재의 전용 채널이 아님");
      continue;
    }
    candidates.push({
      id: c.id,
      title: c.title,
      handle: c.handle,
      subscribers: c.subscribers,
      videoCount: c.videoCount,
      sizeRatio: me.subscribers && c.subscribers ? Math.round((c.subscribers / me.subscribers) * 10) / 10 : null,
      sampleTitles: titles.slice(0, 3),
      relevance: v?.relevance ?? s.titleMatchPct,
      verdict: v?.verdict === "partial" ? "partial" : "dedicated",
      reason: v?.reason ? cleanReason(v.reason) : `최근 영상의 ${s.titleMatchPct}%가 제목에서 핵심어를 직접 다룸`,
      ...s,
    });
  }

  const closeness = (c: Candidate) => (c.sizeRatio ? Math.abs(Math.log(c.sizeRatio)) : 99);
  candidates.sort((a, b) => b.relevance - a.relevance || closeness(a) - closeness(b));
  return { candidates: candidates.slice(0, 15), excluded, notes, stats: { pool: pool.length, checked: survivors.length } };
}
