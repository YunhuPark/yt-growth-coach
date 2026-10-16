import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Idea } from "./recommend";
import { mapPool } from "./util";
import { findTimestamps, searchLong, timestampComments, videoInfo } from "./youtube";

const Plan = z.object({
  queries: z
    .array(z.string())
    .describe(
      "원본 영상(예능 회차, 라이브, 인터뷰)을 찾기 위한 유튜브 검색어 3개. 각 검색어는 2~4단어로 짧게, 그룹·인물·프로그램 같은 고유명사를 반드시 포함. 긴 문장형 검색어는 엉뚱한 영상이 나오므로 금지",
    ),
  must_include: z
    .array(z.string())
    .describe("원본 영상의 제목·채널명·설명에 반드시 나와야 하는 고유명사(그룹·인물·프로그램명)와 표기 변형 3~8개. 일반어는 금지"),
  scene: z.string().describe("찾아야 할 장면을 한 문장으로"),
});

/** A guess from the title/channel name only; the uploader's actual rights can't be known from the API. */
export type SourceKind = "official" | "fan_edit" | "unknown";

export type SourceVideo = {
  id: string;
  kind: SourceKind;
  title: string;
  channelTitle: string;
  durationSec: number;
  views: number;
  publishedAt: string;
  chapters: { sec: number; label: string }[]; // timestamps the uploader listed in the description
  hotspots: { sec: number; text: string; likes: number }[]; // viewer comments pointing at a moment
};

export type SourceResult = { queries: string[]; scene: string; videos: SourceVideo[]; commentsAvailable: boolean };

const FAN_EDIT = /모음|compilation|compil|하이라이트|짤|클립|편집|\.zip|\bshorts?\b|쇼츠/i;
// Broadcaster names only count at the start of a word, so "MBCkpop" matches but "Athena" doesn't hit "ena".
const BROADCASTER = /(?<![a-z])(?:mbc|kbs|sbs|jtbc|tvn|mnet|ebs|cj\s?enm)|(?<![a-z])ena(?![a-z])/i;
const OFFICIAL_WORD = /\bofficial\b|공식/i;
const STUDIO_MARK = /스튜디오|\bstudio\b|\bofficial\b|공식/i;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/**
 * A guess from titles and channel names only. `coreTerms` are the idea's proper nouns (group, person, show): a channel
 * that names the subject and also looks like a studio/official channel is treated as official.
 */
export function classifySource(title: string, channelTitle: string, coreTerms: string[] = []): SourceKind {
  const channel = norm(channelTitle);
  const namesTheSubject = coreTerms.some((t) => norm(t).length >= 2 && channel.includes(norm(t)));
  if (BROADCASTER.test(channelTitle) || OFFICIAL_WORD.test(channelTitle) || (namesTheSubject && STUDIO_MARK.test(channelTitle))) {
    return "official";
  }
  if (FAN_EDIT.test(title)) return "fan_edit";
  return "unknown";
}

export async function findSources(idea: Idea, hashtags: string[], region: string, myChannelId: string): Promise<SourceResult> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY가 .env.local에 설정되지 않았습니다.");

  const client = new Anthropic();
  const plan = await client.messages.parse({
    model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: zodOutputFormat(Plan) },
    system:
      "당신은 유튜브 영상 리서처입니다. 쇼츠 아이디어를 읽고, 그 장면이 들어 있을 만한 원본 영상을 찾는 검색어를 만듭니다. 다른 팬 편집 영상이 아니라 원본(예능 회차, 라이브, 인터뷰)이 나오도록 쓰세요. 한국어.",
    messages: [{ role: "user", content: JSON.stringify({ idea, channel_hashtags: hashtags.slice(0, 12) }) }],
  });
  if (!plan.parsed_output) throw new Error("검색어를 만들지 못했습니다.");
  const { queries, scene, must_include } = plan.parsed_output;
  const terms = must_include.map((t) => t.toLowerCase().replace(/\s+/g, "")).filter((t) => t.length >= 2);

  // 3 queries x (medium, long) = 6 searches, ~600 quota units
  const ids: string[] = [];
  for (const q of queries.slice(0, 3)) {
    for (const d of ["medium", "long"] as const) {
      try {
        for (const id of await searchLong(q, region, d)) if (!ids.includes(id)) ids.push(id);
      } catch {
        /* one failed search shouldn't sink the rest */
      }
    }
  }

  // Comments need a plain API key (the read-only OAuth scope is rejected for comments).
  const commentsAvailable = !!process.env.YOUTUBE_API_KEY;

  const info = (await videoInfo(ids.slice(0, 20)))
    .filter((v) => v.channelId !== myChannelId && v.durationSec >= 240 && v.durationSec <= 4 * 3600)
    // Relevance gate: search results can drift, so require the idea's proper nouns somewhere in the video's own text.
    .filter((v) => {
      const text = `${v.title} ${v.channelTitle} ${v.description.slice(0, 1500)}`.toLowerCase().replace(/\s+/g, "");
      return terms.some((t) => text.includes(t));
    })
    .slice(0, 10);

  const videos = await mapPool(info, 4, async (v): Promise<SourceVideo> => {
    const chapters = v.description
      .split("\n")
      .map((l) => ({ l: l.trim(), ts: findTimestamps(l.trim().slice(0, 12)) }))
      .filter((x) => x.ts.length)
      .map((x) => ({ sec: x.ts[0], label: x.l.replace(/^[\s\S]{0,12}?\d{1,2}:\d{2}(?::\d{2})?\s*[-–—:]?\s*/, "").slice(0, 60) || x.l.slice(0, 60) }))
      .slice(0, 8);
    const hotspots = commentsAvailable && info.indexOf(v) < 6 ? await timestampComments(v.id) : [];
    return {
      id: v.id,
      kind: classifySource(v.title, v.channelTitle, terms),
      title: v.title,
      channelTitle: v.channelTitle,
      durationSec: v.durationSec,
      views: v.views,
      publishedAt: v.publishedAt,
      chapters,
      hotspots,
    };
  });
  // Likely-official sources first, other fans' edits last.
  const order: Record<SourceKind, number> = { official: 0, unknown: 1, fan_edit: 2 };
  videos.sort((a, b) => order[a.kind] - order[b.kind]);
  return { queries, scene, videos, commentsAvailable };
}
