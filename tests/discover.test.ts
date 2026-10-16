import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchStats } from "../src/lib/discover";
import type { RawVideo } from "../src/lib/youtube";
import { daysAgo, NOW } from "./helpers";

const raw = (i: number, over: Partial<RawVideo> = {}): RawVideo => ({
  id: `c${i}`,
  title: `영상 ${i}`,
  publishedAt: daysAgo(10),
  durationSec: 20,
  format: "short",
  views: 1000,
  likes: 10,
  comments: 1,
  channelId: "UCchannel",
  channelTitle: "채널",
  ...over,
});

const TERMS = ["프로미스나인", "fromis_9", "송하영"];

describe("matchStats: does the channel really cover my niche?", () => {
  it("counts a video when the core term is in the title text, ignoring case and spaces", () => {
    const s = matchStats([raw(1, { title: "[프로미스나인] 귀여운 순간" }), raw(2, { title: "FROMIS_9 라이브" }), raw(3, { title: "송 하영 모음" })], TERMS, NOW);
    assert.equal(s.titleMatchPct, 100);
    assert.equal(s.hashtagOnlyPct, 0);
  });

  it("does not count a term that appears only as a hashtag in the title", () => {
    const s = matchStats([raw(1, { title: "오늘의 일상 #프로미스나인", hashtags: ["프로미스나인"] })], TERMS, NOW);
    assert.equal(s.titleMatchPct, 0);
    assert.equal(s.hashtagOnlyPct, 100); // the hashtag-stuffing signal
  });

  it("counts creator tags as metadata-only matches", () => {
    const s = matchStats([raw(1, { title: "브이로그", tags: ["프로미스나인", "아이돌"] })], TERMS, NOW);
    assert.equal(s.titleMatchPct, 0);
    assert.equal(s.hashtagOnlyPct, 100);
  });

  it("counts a video once, as a title match, when both the title and the tags mention the term", () => {
    const s = matchStats([raw(1, { title: "프로미스나인 직캠", hashtags: ["프로미스나인"], tags: ["프로미스나인"] })], TERMS, NOW);
    assert.equal(s.titleMatchPct, 100);
    assert.equal(s.hashtagOnlyPct, 0);
  });

  it("separates a dedicated channel from one that only pads hashtags", () => {
    const dedicated = Array.from({ length: 10 }, (_, i) => raw(i, { title: `[프로미스나인] 장면 ${i}` }));
    const padded = Array.from({ length: 10 }, (_, i) => raw(i, { title: `아무 영상 ${i} #프로미스나인`, hashtags: ["프로미스나인"] }));
    assert.equal(matchStats(dedicated, TERMS, NOW).titleMatchPct, 100);
    const p = matchStats(padded, TERMS, NOW);
    assert.equal(p.titleMatchPct, 0);
    assert.equal(p.hashtagOnlyPct, 100);
  });

  it("ignores one-character terms, which would match almost anything", () => {
    const s = matchStats([raw(1, { title: "가나다라" })], ["가"], NOW);
    assert.equal(s.titleMatchPct, 0);
  });

  it("rounds percentages and reports format, recency and typical views", () => {
    const vids = [
      raw(1, { title: "프로미스나인", views: 100, publishedAt: daysAgo(5) }),
      raw(2, { title: "다른 영상", views: 300, publishedAt: daysAgo(40) }),
      raw(3, { title: "또 다른 영상", views: 200, format: "long", durationSec: 600, publishedAt: daysAgo(200) }),
    ];
    const s = matchStats(vids, TERMS, NOW);
    assert.equal(s.titleMatchPct, 33);
    assert.equal(s.shortsPct, 67);
    assert.equal(s.uploads90d, 2);
    assert.equal(s.medianViews, 200);
  });
});
