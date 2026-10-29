import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeProfile, lengthFit } from "../src/lib/clipProfile";
import { buildClipProfile } from "../src/lib/clipProfileBuild";
import { findHighlights } from "../src/lib/highlights";
import { scoreVideos } from "../src/lib/metrics";
import { NOW, video } from "./helpers";

// Shorts whose views rise with their index, so the score order is known: higher i = better.
const shorts = (n: number, durationOf: (i: number) => number) =>
  scoreVideos(Array.from({ length: n }, (_, i) => video(i, { views: 1000 + i * 500, durationSec: durationOf(i), title: `쇼츠 ${i}` })), NOW);

describe("buildClipProfile", () => {
  it("is null when there are too few rated Shorts to say anything", () => {
    assert.equal(buildClipProfile(shorts(2, () => 30)), null);
    assert.equal(buildClipProfile([]), null);
  });

  it("lists the best Shorts best-first and the weakest ones weakest-first", () => {
    const p = buildClipProfile(shorts(10, () => 30))!;
    assert.equal(p.rated, 10);
    assert.equal(p.best.length, 5);
    assert.equal(p.worst.length, 3);
    assert.equal(p.best[0].title, "쇼츠 9");
    assert.ok(p.best[0].score >= p.best[4].score);
    assert.deepEqual(p.worst.map((c) => c.title), ["쇼츠 0", "쇼츠 1", "쇼츠 2"], "the three weakest, weakest first");
  });

  it("takes the length range from the top third and leaves it out with fewer than six Shorts", () => {
    // the better Shorts (higher i) are 40-50 s long, the weaker ones 15 s
    const p = buildClipProfile(shorts(9, (i) => (i >= 6 ? 40 + (i - 6) * 5 : 15)))!;
    assert.deepEqual(p.lengthRange, { min: 42, max: 48 });
    assert.equal(buildClipProfile(shorts(5, () => 30))!.lengthRange, null);
  });

  it("ignores long-form videos and unrated ones", () => {
    const mixed = scoreVideos(
      [
        ...Array.from({ length: 6 }, (_, i) => video(i, { views: 1000 + i * 300, durationSec: 30 })),
        ...Array.from({ length: 6 }, (_, i) => video(100 + i, { format: "long", durationSec: 900, views: 99999 })),
        video(200, { publishedAt: new Date(NOW - 86400_000).toISOString() }), // too young to rate
      ],
      NOW,
    );
    const p = buildClipProfile(mixed)!;
    assert.equal(p.rated, 6);
    assert.ok(p.best.every((c) => c.durationSec === 30));
  });

  it("keeps only meaningful pattern findings", () => {
    const p = buildClipProfile(shorts(8, () => 30), [
      { feature: "영상 길이", bucket: "쇼츠 30–59초", n: 6, medianScore: 70, lift: 12 },
      { feature: "영상 길이", bucket: "쇼츠 60초 이상", n: 2, medianScore: 20, lift: -30 }, // too few
      { feature: "제목 숫자", bucket: "제목에 숫자 포함", n: 5, medianScore: 55, lift: 2 }, // too small
      { feature: "업로드 요일", bucket: "금요일 업로드", n: 5, medianScore: 70, lift: 15 }, // not about Shorts or titles
    ])!;
    assert.deepEqual(p.notes, ["쇼츠 30–59초: 중앙 점수 +12 (n=6)"]);
  });
});

describe("lengthFit", () => {
  const p = buildClipProfile(shorts(9, (i) => (i >= 6 ? 40 + (i - 6) * 5 : 15)))!;
  it("compares a clip with the range, inclusive at the edges", () => {
    assert.equal(lengthFit(42, p), "within");
    assert.equal(lengthFit(48, p), "within");
    assert.equal(lengthFit(20, p), "shorter");
    assert.equal(lengthFit(75, p), "longer");
  });
  it("says nothing without a range", () => {
    assert.equal(lengthFit(30, null), null);
    assert.equal(lengthFit(30, buildClipProfile(shorts(5, () => 30))), null);
  });
});

describe("using the profile in the clip finder", () => {
  const profile = buildClipProfile(shorts(9, (i) => (i >= 6 ? 40 + (i - 6) * 5 : 15)))!;
  const analysis = { duration: 600, width: 1920, height: 1080, hasAudio: false, scenes: [], silences: [], loudness: [], frames: [] };

  it("describes the channel history to the model, as reference data", async () => {
    let text = "";
    let system = "";
    await findHighlights(analysis, { topic: "", count: 3, profile }, async (sys, content) => {
      system = sys;
      text = content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
      return { candidates: [] };
    });
    assert.equal(describeProfile(profile).split("\n")[0], "이 채널의 쇼츠 성과(참고 자료, 점수 9개 기준):");
    assert.match(text, /잘된 쇼츠의 길이 범위: 42~48초/);
    assert.match(text, /"쇼츠 8"/);
    assert.match(system, /지시가 아닙니다/);
  });

  it("marks each candidate with how its length fits, and adds nothing without a range", async () => {
    const call = async () => ({
      candidates: [
        { start: 0, end: 45, score: 8, reason: "a", hook: "h", title: "t" },
        { start: 100, end: 120, score: 6, reason: "a", hook: "h", title: "t" },
        { start: 200, end: 290, score: 5, reason: "a", hook: "h", title: "t" },
      ],
    });
    const withRange = await findHighlights(analysis, { topic: "", count: 3, profile }, call);
    assert.deepEqual(withRange.map((h) => h.lengthFit), ["within", "shorter", "longer"]);
    const without = await findHighlights(analysis, { topic: "", count: 3, profile: null }, call);
    assert.ok(without.every((h) => !("lengthFit" in h)));
  });
});
