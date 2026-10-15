import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { PatternRow, Scored } from "./metrics";
import type { TrendData } from "./trends";

const Idea = z.object({
  format: z.enum(["long", "short", "reels"]),
  title: z.string().describe("제목 후보 (채널에서 성과가 좋았던 제목 패턴 반영)"),
  hook: z.string().describe("첫 3초(쇼츠/릴스) 또는 첫 30초(롱폼) 오프닝 멘트"),
  outline: z.array(z.string()).describe("구성 3~5단계, 각 단계는 한 줄"),
  cta: z.string().describe("구독/댓글/공유 유도 CTA 문구와 넣을 위치"),
  why: z.string().describe("추천 근거 한 문장. 제공된 데이터의 수치 1~2개 인용"),
  basedOn: z.enum(["my_channel", "trend", "competitor", "mixed"]),
  confidence: z.enum(["high", "medium", "low"]),
});

export type Idea = z.infer<typeof Idea>;

export const Recommendation = z.object({
  headline: z.string().describe("채널의 현재 상황과 가장 큰 병목을 한 문장으로 (60자 안팎)"),
  key_findings: z
    .array(
      z.object({
        label: z.string().describe("지표 이름 (예: '구독 전환', '조회 집중도')"),
        value: z.string().describe("핵심 수치 하나 (예: '0.16명 / 1천 조회')"),
        note: z.string().describe("비교 기준과 의미를 짧게 (예: '채널 중앙값 0.33의 절반')"),
      }),
    )
    .describe("가장 중요한 지표 3~4개"),
  actions: z
    .array(
      z.object({
        priority: z.number().describe("1이 가장 먼저. 1~3"),
        kind: z.enum(["keep", "fix", "stop"]),
        title: z.string().describe("할 일을 한 줄로 (30자 안팎, 명령형)"),
        evidence: z.string().describe("근거 한 문장. 수치는 최대 2개"),
        how: z.string().describe("바로 실행할 구체적 방법 1~2문장"),
      }),
    )
    .describe("지금 해야 할 일 5~7개. priority 순"),
  ideas: z.array(Idea).describe("다음 2주 안에 제작할 영상 아이디어 6~8개, 우선순위 순"),
  data_gaps: z.array(z.string()).describe("판단 정확도를 높이려면 필요한 추가 데이터. 최대 3개, 각 한 문장"),
});
export type Recommendation = z.infer<typeof Recommendation>;

const SYSTEM = `당신은 유튜브 채널 성장 전략가입니다. 크리에이터의 실제 채널 지표와 시장 트렌드 데이터를 받아, 다음에 어떤 영상·쇼츠·릴스를 만들어야 조회수가 잘 나올지 알려줍니다.

원칙:
- 모든 주장은 제공된 데이터의 수치로 뒷받침합니다. 근거가 약하면 confidence를 low로 두고 그렇게 말합니다. 데이터에 없는 수치를 만들지 않습니다.
- 표본이 적은 패턴(n<5)은 단정하지 말고 "가설"로 표현합니다.
- top_videos는 지속률·참여·구독 전환을 섞은 품질 점수 순이라 조회수가 크게 터진 영상이 낮게 나올 수 있습니다. 조회수가 목표라면 top_by_views와 views_concentration(소수 영상에 조회수가 쏠린 정도)을 가장 직접적인 신호로 보고, 터진 영상의 공통점(주제·소재·길이·제목 구조)을 우선 분석합니다.
- tracked_results가 있으면 이전 추천을 따라 만든 영상의 실제 결과입니다. beatsPctOfMyPastVideos는 내 과거 영상 중 이긴 비율(높을수록 좋음)입니다. 시도한 요소(leversTried)가 목표 지표를 실제로 움직였는지를 가장 먼저 평가해서, 효과가 있던 요소는 늘리고 없던 요소는 바꾸는 방향으로 추천합니다. 영상이 1~2개뿐이면 확정하지 말고 가설로 표현합니다.
- 내 채널에서 이미 검증된 패턴을 우선하고, 트렌드/경쟁 채널 데이터는 주제 확장과 포맷 선택에 씁니다.
- 경쟁 채널의 제목·썸네일을 베끼지 말고, 성과 패턴(주제, 길이, 훅 구조)만 참고해 독자적인 아이디어로 바꿉니다.
- 쇼츠와 롱폼의 성과는 서로 다른 시스템이므로 섞어서 비교하지 않습니다. 릴스는 YouTube 데이터가 없으므로, 성과가 좋은 쇼츠를 세로 영상으로 재활용하는 아이디어로만 제안하고 한계를 data_gaps에 적습니다.
- 평균 시청 지속률, CTR, CTA 반응, 구독 전환(CVR) 중 어느 병목인지 짚어서 처방합니다.
- 한국어로 답합니다. 아이디어는 바로 촬영할 수 있을 만큼 구체적으로 씁니다.
- 읽기 쉽게 씁니다. 모든 필드는 짧은 문장으로, 한 항목에 수치는 최대 2개만 씁니다. 같은 수치를 여러 항목에 반복하지 않습니다. 긴 설명 대신 "무엇을 / 왜 / 어떻게"를 각각의 필드에 나눠 담습니다.
- 데이터에서 가장 최근 업로드가 오래됐다면 그 사실을 반드시 첫 번째 우선순위 근거로 고려합니다.`;

const slim = (v: Scored) => ({
  title: v.title,
  format: v.format,
  min: Math.round(v.durationSec / 6) / 10,
  views: v.views,
  viewsPerDay: Math.round(v.viewsPerDay),
  ageDays: Math.round(v.ageDays),
  score: v.score,
  retentionPct: v.avgViewPct && Math.round(v.avgViewPct * 10) / 10,
  ctrPct: v.ctr && Math.round(v.ctr * 10) / 10,
  ctaPct: v.ctaPct && Math.round(v.ctaPct * 100) / 100,
  subsPer1kViews: v.cvrPer1k && Math.round(v.cvrPer1k * 100) / 100,
  retro: v.retro,
});

/** How many videos it takes to reach half of all views, a hit-driven vs. steady channel signal. */
function concentration(scored: Scored[]) {
  const total = scored.reduce((s, v) => s + v.views, 0);
  let acc = 0;
  let n = 0;
  for (const v of [...scored].sort((a, b) => b.views - a.views)) {
    acc += v.views;
    n++;
    if (acc >= total * 0.5) break;
  }
  return { totalVideos: scored.length, videosFor50PctOfViews: n, totalViews: total };
}

export async function recommend(input: {
  channel: { title: string; subscribers: number; videoCount: number };
  scored: Scored[];
  patterns: PatternRow[];
  trends: TrendData | null;
  goal?: string;
  /** results of videos made from earlier recommendations (see tracking.ts) */
  tracked?: unknown;
}): Promise<Recommendation> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY가 .env.local에 설정되지 않았습니다.");
  }
  const client = new Anthropic();
  const rated = input.scored.filter((v) => v.score !== null).sort((a, b) => b.score! - a.score!);

  const payload = {
    channel: input.channel,
    goal: input.goal || "조회수와 구독자 증가",
    top_videos: rated.slice(0, 8).map(slim),
    top_by_views: [...input.scored].sort((a, b) => b.views - a.views).slice(0, 8).map(slim),
    views_concentration: concentration(input.scored),
    tracked_results: input.tracked ?? null,
    bottom_videos: rated.slice(-5).map(slim),
    patterns: input.patterns.slice(0, 12),
    trends: input.trends && {
      popular_now: input.trends.popular.slice(0, 15),
      competitor_hits: input.trends.competitors,
      keyword_top: input.trends.keywords.map((k) => ({ ...k, videos: k.videos.slice(0, 8) })),
    },
  };

  const res = await client.messages.parse({
    model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: zodOutputFormat(Recommendation) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `아래 데이터를 분석해서 다음에 만들 콘텐츠를 추천해 주세요.\n\n${JSON.stringify(payload)}`,
      },
    ],
  });

  if (res.stop_reason === "refusal" || !res.parsed_output) {
    throw new Error("추천 결과를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  return res.parsed_output;
}
