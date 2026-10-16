import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { median, patternInsights, scoreVideos, summarize } from "../src/lib/metrics";
import { daysAgo, NOW, video } from "./helpers";

describe("median", () => {
  it("handles empty, odd and even lengths", () => {
    assert.equal(median([]), 0);
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });
});

describe("scoreVideos", () => {
  it("does not score videos younger than 7 days", () => {
    const vids = [...[1, 2, 3, 4, 5].map((i) => video(i, { views: i * 1000 })), video(99, { publishedAt: daysAgo(3), views: 50_000 })];
    const scored = scoreVideos(vids, NOW);
    assert.equal(scored.find((v) => v.id === "v99")!.score, null);
    assert.ok(scored.filter((v) => v.id !== "v99").every((v) => typeof v.score === "number"));
  });

  it("needs at least 3 settled videos in a format before ranking it", () => {
    const shorts = [1, 2].map((i) => video(i, { views: i * 1000 }));
    const longs = [3, 4, 5, 6, 7].map((i) => video(i, { format: "long", durationSec: 600, views: i * 1000 }));
    const scored = scoreVideos([...shorts, ...longs], NOW);
    assert.ok(scored.filter((v) => v.format === "short").every((v) => v.score === null));
    assert.ok(scored.filter((v) => v.format === "long").every((v) => v.score !== null));
  });

  it("ranks shorts and long-form separately", () => {
    // Shorts are 100x larger than long-form. Mixed together the weakest short would still beat every long video.
    const shorts = [1, 2, 3, 4].map((i) => video(i, { views: i * 10_000 }));
    const longs = [5, 6, 7, 8].map((i) => video(i, { format: "long", durationSec: 600, views: (i - 4) * 100 }));
    const scored = scoreVideos([...shorts, ...longs], NOW);
    const weakestShort = scored.find((v) => v.id === "v1")!;
    const weakestLong = scored.find((v) => v.id === "v5")!;
    assert.equal(weakestShort.parts.reach, 12.5); // 0.5 of 4 videos beaten, within shorts only
    assert.equal(weakestLong.parts.reach, 12.5);
  });

  it("gives higher scores to videos that are better on every metric", () => {
    const vids = [1, 2, 3, 4, 5, 6].map((i) =>
      video(i, { views: i * 1000, likes: i * 80, comments: i * 10, shares: i * 5, avgViewPct: 30 + i * 5, subsGained: i * 3 }),
    );
    const scored = scoreVideos(vids, NOW);
    const byScore = [...scored].sort((a, b) => a.score! - b.score!).map((v) => v.id);
    assert.deepEqual(byScore, ["v1", "v2", "v3", "v4", "v5", "v6"]);
  });

  it("re-normalizes the weights when a metric is unavailable", () => {
    // No retention/ctr/subscriber data: only reach (0.20) and engagement (0.15) can contribute.
    // Likes scale with views and there are no comments, so every video has the same 10% engagement (a tie = 50th percentile).
    const vids = [1, 2, 3, 4, 5].map((i) => video(i, { views: i * 1000, likes: i * 100, comments: 0 }));
    const top = scoreVideos(vids, NOW).find((v) => v.id === "v5")!;
    assert.equal(top.parts.retention, undefined);
    assert.equal(top.parts.cvr, undefined);
    assert.equal(top.parts.reach, 90);
    assert.equal(top.parts.engagement, 50);
    assert.equal(top.score, Math.round((90 * 0.2 + 50 * 0.15) / 0.35));
  });

  it("computes subscriber conversion per 1k views and the CTA rate", () => {
    const [v] = scoreVideos([video(1, { views: 10_000, subsGained: 5, comments: 10, shares: 30 })], NOW);
    assert.equal(v.cvrPer1k, 0.5);
    assert.equal(v.ctaPct, 0.4); // (10 comments + 30 shares) / 10,000
  });

  it("leaves CTA and conversion undefined when the Analytics data is missing", () => {
    const [v] = scoreVideos([video(1, { views: 10_000 })], NOW);
    assert.equal(v.cvrPer1k, undefined);
    assert.equal(v.ctaPct, undefined);
  });

  it("flags clicks that don't turn into watch time, and the reverse", () => {
    const base = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => video(i, { ctr: 4, avgViewPct: 50, views: 1000 + i }));
    const clickbait = video(20, { ctr: 8, avgViewPct: 20 });
    const hidden = video(21, { ctr: 2, avgViewPct: 90 });
    const scored = scoreVideos([...base, clickbait, hidden], NOW);
    assert.ok(scored.find((v) => v.id === "v20")!.retro.bad.some((t) => t.includes("초반")));
    assert.ok(scored.find((v) => v.id === "v21")!.retro.good.some((t) => t.includes("제목·썸네일")));
  });
});

describe("patternInsights", () => {
  const withTitles = (n: number, titles: (i: number) => string, views: (i: number) => number) =>
    Array.from({ length: n }, (_, k) => video(k + 1, { title: titles(k + 1), views: views(k + 1) }));

  it("returns nothing for fewer than 8 rated videos", () => {
    const scored = scoreVideos(withTitles(7, (i) => `제목 ${i}`, (i) => i * 100), NOW);
    assert.deepEqual(patternInsights(scored), []);
  });

  it("shows which title feature goes with better scores, and only for groups of 3+", () => {
    // Videos with a number in the title are the strong ones.
    const vids = withTitles(
      12,
      (i) => (i % 2 === 0 ? `${i}가지 방법` : "일상 기록"),
      (i) => (i % 2 === 0 ? 50_000 + i * 1000 : 500 + i),
    );
    const rows = patternInsights(scoreVideos(vids, NOW));
    const withNumber = rows.find((r) => r.bucket === "제목에 숫자 포함")!;
    const without = rows.find((r) => r.bucket === "제목에 숫자 없음")!;
    assert.ok(withNumber.lift > 0, `lift was ${withNumber.lift}`);
    assert.ok(without.lift < 0, `lift was ${without.lift}`);
    assert.ok(rows.every((r) => r.n >= 3));
  });
});

describe("summarize", () => {
  it("counts rated videos and reports per-format medians", () => {
    const shorts = [1, 2, 3, 4].map((i) => video(i, { views: i * 1000, avgViewPct: 60 }));
    const scored = scoreVideos([...shorts, video(50, { publishedAt: daysAgo(2) })], NOW);
    const s = summarize(scored);
    assert.equal(s.rated, 4);
    assert.equal(s.byFormat.short.n, 4);
    assert.equal(s.byFormat.long.n, 0);
    assert.equal(s.byFormat.short.medianRetention, 60);
  });
});
