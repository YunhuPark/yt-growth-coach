import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { topHashtags } from "./discover";
import type { PatternRow, Scored } from "./metrics";
import type { Idea } from "./recommend";

export const Pack = z.object({
  titles: z
    .array(
      z.object({
        text: z.string().describe("제목 (말머리 포함, 25자 안팎). 모르는 사건은 [상황]처럼 대괄호 빈칸으로 둠"),
        style: z.string().describe("이 제목의 접근 (예: '상황+반응 서사형', '비교 구도형')"),
      }),
    )
    .describe("제목 3안. 서로 다른 접근으로"),
  hook_caption: z.string().describe("첫 2초 화면 자막 한 줄. 모르는 사건은 빈칸으로"),
  shot_plan: z
    .array(
      z.object({
        time: z.string().describe("구간 (예: '0–2초')"),
        pick: z.string().describe("이 구간에 쓸 장면의 종류와 고르는 기준. 특정 사건을 단정하지 않음"),
        caption: z.string().describe("이 구간에 올릴 자막. 없으면 빈 문자열"),
        edit_tip: z.string().describe("편집 팁 한 줄 (컷 속도, 확대, 효과음 등)"),
      }),
    )
    .describe("15~25초 쇼츠 기준 4~6개 구간"),
  ending_cta: z.string().describe("마지막 1~2초 엔딩 카드 문구. 15자 안팎, 구독해야 하는 이유가 드러나게"),
  pinned_comment: z.string().describe("고정 댓글 본문. 다음 편 예고나 투표처럼 댓글·구독을 부르는 문구"),
  description: z.string().describe("영상 설명 2~3줄. 시리즈 재생목록 안내 포함"),
  hashtags: z
    .array(z.string())
    .describe("영상 내용과 직접 관련된 해시태그 3~5개('#' 포함). 조회수용 무관한 태그 금지. 앞의 3개가 제목 위에 노출됨"),
  upload_slot: z.string().describe("추천 업로드 요일·시간대와 근거 한 줄"),
  fill_in: z.array(z.string()).describe("클립을 확인한 뒤 사용자가 직접 채우거나 확인해야 할 것들 (빈칸, 사실 확인)"),
});
export type Pack = z.infer<typeof Pack>;

const SYSTEM = `당신은 유튜브 쇼츠 제작 보조자입니다. 크리에이터가 직접 영상을 편집하기 전에 필요한 텍스트 자산(제목, 자막, 컷 구성, CTA, 고정 댓글, 설명, 해시태그)을 만들어 줍니다.

원칙:
- 당신은 실제 클립을 볼 수 없습니다. 클립에서 무슨 일이 일어나는지 단정하지 마세요. 제목·자막에서 구체적 사건·대사·인물 간 상황이 필요한데 모르면 [상황], [멤버] 같은 대괄호 빈칸으로 두고, 그 항목을 fill_in에 적으세요. 클립과 다른 제목은 이탈과 낚시 논란을 부릅니다.
- 제목은 이 채널에서 이미 조회수가 높았던 제목 구조(말머리 + 상황·반응 서사)를 따르되, 기존 제목을 그대로 베끼지 않습니다.
- shot_plan은 "어떤 종류의 장면을 어떤 기준으로 고를지"를 적습니다. 특정 방송·영상 파일을 지목하거나 내려받는 방법은 쓰지 않습니다.
- 해시태그는 영상 내용과 직접 관련된 것만 3~5개. 조회수를 위해 무관한 인기 태그를 끼워 넣지 않습니다.
- 현재 채널의 약점(구독 전환, CTA 반응이 낮음, 시리즈 부재)을 해결하는 방향으로 ending_cta, pinned_comment, description을 씁니다.
- 한국어로, 짧고 바로 복사해 쓸 수 있게 씁니다.`;

export async function makePackage(input: {
  idea: Idea;
  channelTitle: string;
  scored: Scored[];
  patterns: PatternRow[];
  actions: string[];
}): Promise<Pack> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY가 .env.local에 설정되지 않았습니다.");
  const byViews = [...input.scored].sort((a, b) => b.views - a.views);
  const settled = input.scored.filter((v) => v.score !== null);

  const client = new Anthropic();
  const res = await client.messages.parse({
    model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: zodOutputFormat(Pack) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          channel: input.channelTitle,
          idea: input.idea,
          best_titles_by_views: byViews.slice(0, 12).map((v) => ({ title: v.title, views: v.views, sec: v.durationSec })),
          weakest_titles: [...settled].sort((a, b) => a.score! - b.score!).slice(0, 5).map((v) => v.title),
          title_patterns: input.patterns.slice(0, 8),
          frequent_hashtags: topHashtags(input.scored, 12),
          todo_from_recommendation: input.actions,
        }),
      },
    ],
  });
  if (!res.parsed_output) throw new Error("제작 패키지를 만들지 못했습니다. 다시 시도해 주세요.");
  return res.parsed_output;
}
