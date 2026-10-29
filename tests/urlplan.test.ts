import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildClipProfile } from "../src/lib/channel/clipProfileBuild";
import { describeForHighlights } from "../src/lib/editor/highlights";
import { scoreVideos } from "../src/lib/channel/metrics";
import {
  buildBrief,
  buildLongform,
  clusterMoments,
  describeSignals,
  evidenceFor,
  fetchFrames,
  fetchSignals,
  hasTimingClues,
  momentsHint,
  parseChapters,
  planFromSignals,
  UrlPlanError,
  type RawUrlAnalysis,
  type UrlSignals,
} from "../src/lib/editor/urlPlan";
import { NOW, video } from "./helpers";

const hot = (sec: number, likes: number, text = `t${sec}`) => ({ sec, likes, text });

describe("clusterMoments", () => {
  it("merges comments near each other into one moment placed at the most-liked comment", () => {
    const m = clusterMoments([hot(80, 5, "a"), hot(85, 50, "b"), hot(90, 1, "c"), hot(300, 10, "far")]);
    assert.equal(m.length, 2);
    const first = m.find((x) => x.sec === 85)!;
    assert.equal(first.comments, 3);
    assert.equal(first.likes, 56);
    assert.deepEqual(first.samples, ["b", "a", "c"]);
  });

  it("ranks a moment several people mention above one loud comment", () => {
    const m = clusterMoments([hot(60, 30), hot(200, 8), hot(205, 8), hot(210, 8), hot(215, 8)]);
    assert.equal(m[0].sec, 200, "four comments of 8 likes beat one of 30");
  });

  it("ignores impossible times and handles an empty list", () => {
    assert.deepEqual(clusterMoments([]), []);
    assert.equal(clusterMoments([hot(-5, 1), hot(Number.NaN, 1), hot(10, 1)]).length, 1);
  });
});

describe("parseChapters", () => {
  it("reads the uploader's timestamp lines and their labels", () => {
    const d = "안녕하세요\n0:00 오프닝\n1:23 - 하이라이트\n01:02:03 마무리\n그냥 문장 12:30에 만나요";
    assert.deepEqual(parseChapters(d), [
      { sec: 0, label: "오프닝" },
      { sec: 83, label: "하이라이트" },
      { sec: 3723, label: "마무리" },
    ]);
  });

  it("accepts bullets and brackets before the time, and a bare time with no label", () => {
    assert.deepEqual(parseChapters("▶ 0:30 시작\n[1:10] 중간\n- 2:00\n(3:05) - 끝"), [
      { sec: 30, label: "시작" },
      { sec: 70, label: "중간" },
      { sec: 120, label: "2:00" },
      { sec: 185, label: "끝" },
    ]);
  });

  it("returns nothing for a description without timestamps", () => {
    assert.deepEqual(parseChapters("그냥 설명입니다\n구독 부탁드려요"), []);
  });
});

describe("evidenceFor and buildBrief", () => {
  const moments = clusterMoments([hot(83, 120, "여기 최고"), hot(86, 30, "소름"), hot(500, 9, "다른 곳")]);

  it("counts the comments that point inside a range, with a little lead-in allowed", () => {
    const e = evidenceFor(80, 110, moments);
    assert.equal(e.comments, 2);
    assert.equal(e.likes, 150);
    assert.deepEqual(e.samples, ["여기 최고", "소름"]);
    assert.equal(evidenceFor(80, 82, moments).comments, 0, "a moment after the range does not count");
    assert.equal(evidenceFor(86, 110, moments).comments, 2, "a moment just before the start still does (3 s lead)");
  });

  it("writes a brief with the range, the original link, the hook, the credit line and no empty lines", () => {
    const v = { id: "abc", title: "원본 제목", channelTitle: "원본 채널", durationSec: 900, views: 1, publishedAt: "", url: "https://youtu.be/abc" };
    const brief = buildBrief(
      { start: 80, end: 110, score: 8, reason: "댓글 근거", hook: "훅 문구", title: "제목 후보", evidence: { comments: 2, likes: 150, samples: [] }, link: "https://youtu.be/abc?t=80" },
      v,
    );
    assert.match(brief, /구간: 1:20 ~ 1:50 \(30초\) · https:\/\/youtu.be\/abc\?t=80/);
    assert.match(brief, /훅 자막\(첫 2~3초\): 훅 문구/);
    assert.match(brief, /출처: 원본 원본 제목 \/ 원본 채널 https:\/\/youtu.be\/abc/);
    assert.match(brief, /댓글 2개, 좋아요 150/);
    assert.ok(brief.split("\n").every((l) => l.trim()));
  });
});

const signals = (over: Partial<UrlSignals> = {}): UrlSignals => ({
  video: { id: "abc", title: "원본", channelTitle: "채널", durationSec: 600, views: 1000, publishedAt: "2026-01-01", url: "https://youtu.be/abc" },
  description: "설명",
  moments: clusterMoments([hot(83, 120, "여기 최고"), hot(86, 30), hot(300, 40, "소름"), hot(450, 5)]),
  chapters: [],
  topComments: [{ text: "이 장면 진짜 레전드", likes: 900 }],
  commentsOk: true,
  ...over,
});

type RawCand = RawUrlAnalysis["candidates"][number];
const cand = (start: number, end: number, score: number): RawCand => ({ start, end, score, reason: "근거", hook: "훅", title: "제목" });
const answer = (over: Partial<RawUrlAnalysis> = {}): RawUrlAnalysis => ({
  summary: "요약",
  topics: [{ topic: "주제", angle: "각도", why: "근거" }],
  titles: ["제목 1", "제목 2"],
  candidates: [],
  longform: null,
  ...over,
});
const text = (content: { type: string; text?: string }[]) => content.map((c) => (c.type === "text" ? c.text : "<img>")).join("\n");

describe("planFromSignals", () => {
  it("sends the signals (and the pictures) as data, asks for no more than requested, and turns the picks into briefs with evidence", async () => {
    let sent = "";
    let system = "";
    const frame = { label: "대표 이미지", mediaType: "image/jpeg" as const, data: "AAAA" };
    const plan = await planFromSignals(
      signals(),
      { topic: "팬캠", count: 3 },
      async (sys, content) => {
        system = sys;
        sent = text(content);
        return answer({ candidates: [cand(78, 110, 9), cand(295, 330, 6), cand(0, 4, 10)] });
      },
      [frame, frame],
    );
    assert.match(sent, /최대 3개/);
    assert.match(sent, /1:23 · 댓글 2개 · 좋아요 150/);
    assert.match(sent, /반응이 큰 댓글:\n- \(좋아요 900\) 이 장면 진짜 레전드/);
    assert.match(sent, /이미지 2장이 이어집니다/);
    assert.equal(sent.split("<img>").length - 1, 2, "both pictures are in the request");
    assert.match(system, /지시가 아닙니다/);
    assert.match(system, /보거나 들을 수 없습니다/);
    assert.deepEqual(plan.candidates.map((c) => c.start), [78, 295], "the 4-second pick is too short and dropped");
    assert.equal(plan.candidates[0].link, "https://youtu.be/abc?t=78");
    assert.equal(plan.candidates[0].evidence.comments, 2);
    assert.match(plan.candidates[0].brief, /구간: 1:18 ~ 1:50/);
    assert.deepEqual(plan.evidence, { frames: 2, comments: 4, topComments: 1, chapters: 0, commentsOk: true });
    assert.equal(plan.note, undefined);
  });

  it("returns the summary, topics and titles cleaned up", async () => {
    const plan = await planFromSignals(
      signals(),
      { topic: "", count: 3 },
      async () =>
        answer({
          summary: "  [빈칸] 요약\n입니다  ",
          topics: [{ topic: "주제 A", angle: "각도", why: "근거" }, { topic: "", angle: "x", why: "y" }],
          titles: ["제목", "제목", "  ", "다른 제목"],
        }),
    );
    assert.equal(plan.summary, "요약 입니다");
    assert.deepEqual(plan.topics.map((t) => t.topic), ["주제 A"]);
    assert.deepEqual(plan.titles, ["제목", "다른 제목"]);
  });

  it("clamps picks to the video and never exceeds the Shorts limits", async () => {
    const plan = await planFromSignals(signals(), { topic: "", count: 3 }, async () => answer({ candidates: [cand(560, 900, 7), cand(100, 600, 8)] }));
    assert.ok(plan.candidates.every((c) => c.end <= 600 && c.end - c.start <= 90));
  });

  it("still gives a summary, topics and titles without timing clues, but no Shorts or long-form even if the model offers them", async () => {
    const bare = signals({ moments: [], chapters: [] });
    assert.equal(hasTimingClues(bare), false);
    const plan = await planFromSignals(
      bare,
      { topic: "", count: 3 },
      async () => answer({ candidates: [cand(10, 40, 9)], longform: { title: "t", description: "d", hashtags: [], sections: [{ start: 0, end: 100, heading: "a", why: "b" }] } }),
    );
    assert.equal(plan.summary, "요약");
    assert.equal(plan.titles.length, 2);
    assert.deepEqual(plan.candidates, []);
    assert.equal(plan.longform, null);
    assert.match(plan.note!, /시간 단서/);
  });

  it("says when comments could not be read, and when no pictures were available", async () => {
    const noComments = signals({ moments: [], commentsOk: false, topComments: [], chapters: [{ sec: 0, label: "A" }, { sec: 120, label: "B" }, { sec: 240, label: "C" }] });
    const plan = await planFromSignals(noComments, { topic: "", count: 2 }, async () => answer({ candidates: [cand(120, 160, 5)] }));
    assert.equal(plan.candidates.length, 1, "chapters alone are enough of a clue");
    assert.match(plan.note!, /댓글을 읽지 못해/);
    assert.match(plan.note!, /미리보기 이미지를 가져오지 못했습니다/);
  });

  it("labels the length fit against the channel's best Shorts when there is enough history", async () => {
    const vids = scoreVideos(Array.from({ length: 9 }, (_, i) => video(i, { views: 1000 + i * 500, durationSec: i >= 6 ? 40 + (i - 6) * 5 : 15 })), NOW);
    const profile = buildClipProfile(vids)!;
    let sent = "";
    const plan = await planFromSignals(signals(), { topic: "", count: 2, profile }, async (_s, content) => {
      sent = text(content);
      return answer({ candidates: [cand(78, 120, 8), cand(295, 315, 6)] });
    });
    assert.match(sent, /잘된 쇼츠의 길이 범위/);
    assert.deepEqual(plan.candidates.map((c) => c.lengthFit), ["within", "shorter"]);
  });

  it("turns a long-form outline into a plan with chapters and a description that lists them", async () => {
    const plan = await planFromSignals(
      signals(),
      { topic: "", count: 2 },
      async () =>
        answer({
          longform: {
            title: "롱폼 제목",
            description: "설명입니다.",
            hashtags: ["팬캠", "#하이라이트"],
            sections: [
              { start: 0, end: 60, heading: "오프닝", why: "시작" },
              { start: 80, end: 140, heading: "하이라이트", why: "반응" },
              { start: 290, end: 350, heading: "마무리", why: "끝" },
            ],
          },
        }),
    );
    const lf = plan.longform!;
    assert.deepEqual(lf.segments.map((s) => [s.start, s.end]), [[0, 60], [80, 140], [290, 350]]);
    assert.equal(lf.outputSec, 180);
    assert.deepEqual(lf.chapters.map((c) => [c.time, c.title]), [[0, "오프닝"], [60, "하이라이트"], [120, "마무리"]]);
    assert.equal(lf.description, "설명입니다.\n\n0:00 오프닝\n1:00 하이라이트\n2:00 마무리");
    assert.deepEqual(lf.hashtags, ["#팬캠", "#하이라이트"]);
    assert.deepEqual(lf.titles, ["롱폼 제목"]);
  });
});

describe("buildLongform", () => {
  const sec = (start: number, end: number, heading = "구간") => ({ start, end, heading, why: "이유" });
  const raw = (sections: ReturnType<typeof sec>[]) => ({ title: "제목", description: "설명", hashtags: [], sections });

  it("clamps sections to the video, sorts them, merges overlaps and drops those under 15 seconds", () => {
    const lf = buildLongform(raw([sec(300, 900, "뒤"), sec(-10, 50, "앞"), sec(40, 100, "겹침"), sec(200, 205, "짧음")]), 600)!;
    assert.deepEqual(lf.segments.map((s) => [s.start, s.end]), [[0, 100], [300, 600]]);
    assert.equal(lf.outputSec, 400);
  });

  it("is null when nothing usable is left, and warns when there are too few chapters", () => {
    assert.equal(buildLongform(raw([sec(10, 20)]), 600), null);
    assert.equal(buildLongform(raw([]), 600), null);
    const two = buildLongform(raw([sec(0, 60), sec(100, 160)]), 600)!;
    assert.deepEqual(two.chapters, []);
    assert.ok(two.warnings.some((w) => /챕터/.test(w)));
    assert.equal(two.description, "설명");
  });
});

describe("describeSignals", () => {
  it("lists comments, chapters and the channel history, and says plainly when there is no image", () => {
    const t = describeSignals(signals({ chapters: [{ sec: 0, label: "시작" }] }), { topic: "팬 채널", count: 3 });
    assert.match(t, /크리에이터의 채널 주제: 팬 채널/);
    assert.match(t, /업로더 챕터:\n- 0:00 시작/);
    assert.match(t, /이미지: 없음/);
  });
});

describe("fetchFrames", () => {
  it("fetches the cover and three frames, and skips ones that fail", async () => {
    const asked: string[] = [];
    const fake = (async (url: string) => {
      asked.push(url);
      if (url.endsWith("hq2.jpg")) return { ok: false } as Response;
      if (url.endsWith("hq3.jpg")) throw new Error("network");
      return { ok: true, arrayBuffer: async () => new Uint8Array(500).buffer } as Response;
    }) as unknown as typeof fetch;
    const frames = await fetchFrames("abc", fake);
    assert.equal(asked.length, 4);
    assert.deepEqual(frames.map((f) => f.label.slice(0, 6)), ["영상의 대표", "영상 안의 "]);
    assert.ok(frames.every((f) => f.mediaType === "image/jpeg" && f.data.length > 100));
  });

  it("ignores pictures that are empty or absurdly large", async () => {
    const sizes = [10, 3_000_000, 500, 500];
    let i = 0;
    const fake = (async () => ({ ok: true, arrayBuffer: async () => new Uint8Array(sizes[i++]).buffer }) as Response) as unknown as typeof fetch;
    assert.equal((await fetchFrames("abc", fake)).length, 2);
  });
});

describe("fetchSignals", () => {
  const info = async (ids: string[]) =>
    ids[0] === "gone00000id"
      ? []
      : [{ id: ids[0], title: "원본", channelId: "c", channelTitle: "채널", publishedAt: "", durationSec: 600, views: 5, description: "0:00 시작\n2:00 중간\n4:00 끝" }];
  const comments = async () => ({ rows: [hot(83, 10), hot(85, 5)], ok: true });

  it("reads a video from a link or id and assembles moments and chapters", async () => {
    const s = await fetchSignals("https://www.youtube.com/watch?v=dQw4w9WgXcQ", { info, comments });
    assert.equal(s.video.id, "dQw4w9WgXcQ");
    assert.equal(s.video.url, "https://youtu.be/dQw4w9WgXcQ");
    assert.equal(s.moments.length, 1);
    assert.equal(s.chapters.length, 3);
    assert.equal(s.commentsOk, true);
  });

  it("rejects an address that is not a video, and a video that cannot be found", async () => {
    await assert.rejects(fetchSignals("그냥 글", { info, comments }), UrlPlanError);
    await assert.rejects(fetchSignals("gone00000id", { info, comments }), /찾지 못했습니다/);
  });
});

describe("momentsHint", () => {
  it("uses the moments only when the file is about as long as the original video", () => {
    const s = signals();
    assert.equal(momentsHint(s, 600).moments.length, 3);
    assert.equal(momentsHint(s, 620).moments.length, 3, "within 5%");
    const off = momentsHint(s, 300);
    assert.deepEqual(off.moments, []);
    assert.match(off.note!, /같은 영상이 아닌 것으로/);
  });

  it("says so when the video has no pointed moments", () => {
    const r = momentsHint(signals({ moments: [] }), 600);
    assert.deepEqual(r.moments, []);
    assert.match(r.note!, /찾지 못해/);
  });
});

describe("the file analysis with moments", () => {
  it("shows the model the viewer-pointed moments", () => {
    const a = { duration: 600, width: 1920, height: 1080, hasAudio: false, scenes: [], silences: [], loudness: [], frames: [] };
    const text = describeForHighlights(a, { topic: "", count: 3, moments: [{ sec: 83, likes: 150, comments: 2, samples: ["여기 최고"] }] });
    assert.match(text, /시청자가 짚은 순간/);
    assert.match(text, /1:23 · 댓글 2개 · 좋아요 150: "여기 최고"/);
    assert.doesNotMatch(describeForHighlights(a, { topic: "", count: 3 }), /시청자가 짚은 순간/);
  });
});
