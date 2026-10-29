import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { BaselineFile, FrozenResult, TrackEntry } from "../src/lib/shared/store";
import {
  cumulative,
  evaluate,
  freezeCheckpoint,
  isReady,
  learnFromLevers,
  rank,
  summarizeBaseline,
  summarizeCheckpoint,
  trackedForAI,
  verdictFor,
  type CheckpointResult,
  type DayRow,
  type Evaluated,
} from "../src/lib/channel/tracking";
import { DAY, daysAgo, NOW } from "./helpers";

const approx = (a: number | undefined, b: number, eps = 0.01) =>
  assert.ok(a !== undefined && Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);

describe("isReady", () => {
  it("treats checkpoint N as final one day after day N has passed", () => {
    const pub = daysAgo(2);
    assert.equal(isReady(pub, 1, NOW), true);
    assert.equal(isReady(pub, 3, NOW), false);
    assert.equal(isReady(daysAgo(4), 3, NOW), true);
    assert.equal(isReady(daysAgo(1.5), 1, NOW), false);
  });
});

describe("cumulative", () => {
  const rows: DayRow[] = [
    { offset: 0, views: 100, subs: 2, acts: 1, ret: 80 },
    { offset: 1, views: 50, subs: 1, acts: 1, ret: 70 },
    { offset: 2, views: 30, subs: 0, acts: 1, ret: 60 },
    { offset: 3, views: 20, subs: 0, acts: 0, ret: 50 },
  ];

  it("sums only the first N days", () => {
    assert.equal(cumulative(rows, 1)!.views, 100);
    assert.equal(cumulative(rows, 3)!.views, 180);
  });

  it("derives conversion, CTA rate and a view-weighted retention", () => {
    const c = cumulative(rows, 3)!;
    approx(c.cvr, (3 / 180) * 1000);
    approx(c.cta, (3 / 180) * 100);
    approx(c.ret, (80 * 100 + 70 * 50 + 60 * 30) / 180); // days with more views count for more
  });

  it("ignores rows outside the window, including negative offsets", () => {
    const c = cumulative([{ offset: -1, views: 999, subs: 9, acts: 9, ret: 99 }, ...rows], 1)!;
    assert.equal(c.views, 100);
  });

  it("returns null with no data, and leaves ratios undefined for zero views", () => {
    assert.equal(cumulative([], 3), null);
    const z = cumulative([{ offset: 0, views: 0, subs: 0, acts: 0, ret: 0 }], 1)!;
    assert.equal(z.views, 0);
    assert.equal(z.cvr, undefined);
    assert.equal(z.ret, undefined);
  });
});

describe("rank", () => {
  it("is the share of past videos beaten, with ties counting half", () => {
    assert.equal(rank(5, [1, 2, 3, 4, 5]), 90);
    assert.equal(rank(0, [1, 2]), 0);
    assert.equal(rank(10, [1, 2]), 100);
    assert.equal(rank(2, [2, 2, 2, 2]), 50);
  });

  it("returns a neutral 50 when there is too little history", () => {
    assert.equal(rank(123, []), 50);
    assert.equal(rank(123, [7]), 50);
  });
});

describe("verdictFor", () => {
  it("maps percentiles to plain-language verdicts", () => {
    assert.equal(verdictFor(undefined), "집계 중");
    assert.equal(verdictFor(95), "기존 영상 대비 최상위권");
    assert.equal(verdictFor(80), "기존 영상보다 확실히 잘 나옴");
    assert.equal(verdictFor(60), "평균 이상");
    assert.equal(verdictFor(30), "평균 이하");
    assert.equal(verdictFor(10), "기존 영상 중 하위권");
  });
});

describe("summarizeBaseline", () => {
  it("reports quartiles and p90 of each metric", () => {
    const sorted = Array.from({ length: 10 }, (_, i) => i + 1);
    const set = { n: 10, byN: { "7": { views: sorted, cvr: sorted, cta: sorted, ret: sorted } } };
    const file: BaselineFile = { at: new Date(NOW).toISOString(), sets: { short: set } };
    const s = summarizeBaseline(file);
    assert.deepEqual(s.sets.short!.byN["7"].views, { p25: 3, p50: 6, p75: 8, p90: 10 });
    assert.equal(s.sets.short!.n, 10);
    assert.equal(s.sets.long, undefined); // a format with no baseline is simply absent
  });
});

const frozen = (views: number, pct: Record<string, number>, cvr?: number): FrozenResult => ({
  at: new Date(NOW).toISOString(),
  views,
  cvr,
  pct,
});

describe("evaluate", () => {
  let fetchCalls = 0;
  beforeEach(() => {
    fetchCalls = 0;
    // Any API call from these tests is a bug: fail loudly instead of silently hitting the network.
    mock.method(globalThis, "fetch", async () => {
      fetchCalls++;
      throw new Error("network must not be used in this test");
    });
  });
  afterEach(() => mock.restoreAll());

  const entry = (over: Partial<TrackEntry> = {}): TrackEntry => ({
    videoId: "abcdefghijk",
    title: "테스트",
    publishedAt: new Date(Date.now() - 30 * DAY).toISOString(),
    format: "short",
    levers: [],
    linkedAt: new Date().toISOString(),
    ...over,
  });

  it("uses recorded results and makes no API call when every final checkpoint is frozen", async () => {
    const e = entry({
      frozen: {
        "1": frozen(2000, { views: 40, cvr: 55 }, 0.2),
        "3": frozen(3000, { views: 60, cvr: 50 }, 0.25),
        "7": frozen(5000, { views: 91, cvr: 45 }, 0.3),
        "28": frozen(9000, { views: 70, cvr: 40 }, 0.35),
      },
    });
    const ev = await evaluate(e, null);
    assert.equal(fetchCalls, 0);
    assert.ok(ev.checkpoints.every((c) => c.ready && c.frozen));
    assert.equal(ev.checkpoints[2].cum!.views, 5000);
    assert.equal(ev.checkpoints[3].cum!.views, 9000);
    // The latest final checkpoint decides the verdict.
    assert.deepEqual(ev.latestPct, { views: 70, cvr: 40 });
    assert.equal(ev.verdict, "28일차 평균 이상");
    assert.equal(ev.compared, true);
  });

  it("makes no API call once every checkpoint that is final so far has been recorded", async () => {
    // 10 days old: days 1, 3 and 7 are final and recorded; day 28 is not final yet, so there is nothing to fetch.
    const e = entry({
      publishedAt: new Date(Date.now() - 10 * DAY).toISOString(),
      frozen: {
        "1": frozen(2000, { views: 40 }),
        "3": frozen(3000, { views: 60 }),
        "7": frozen(5000, { views: 80 }),
      },
    });
    const ev = await evaluate(e, null);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(
      ev.checkpoints.map((c) => [c.n, c.ready]),
      [[1, true], [3, true], [7, true], [28, false]],
    );
  });

  it("makes no API call for a video that has no final checkpoint yet", async () => {
    const ev = await evaluate(entry({ publishedAt: new Date(Date.now() - 0.5 * DAY).toISOString() }), null);
    assert.equal(fetchCalls, 0);
    assert.ok(ev.checkpoints.every((c) => !c.ready));
    assert.equal(ev.verdict, "아직 1일차 집계 전");
  });
});

describe("freezeCheckpoint / summarizeCheckpoint", () => {
  const cp: CheckpointResult = {
    n: 1,
    ready: true,
    cum: { views: 10226, cvr: 0.29, cta: 0.11, ret: 90 },
    pct: { views: 91, cvr: 61, cta: 21 },
  };

  it("freezes only final checkpoints that have percentiles", () => {
    assert.equal(freezeCheckpoint({ ...cp, ready: false }), null);
    assert.equal(freezeCheckpoint({ ...cp, pct: {} }), null);
    assert.equal(freezeCheckpoint({ ...cp, cum: undefined }), null);
    const f = freezeCheckpoint(cp, "2026-10-16T00:00:00.000Z")!;
    assert.equal(f.views, 10226);
    assert.equal(f.at, "2026-10-16T00:00:00.000Z");
    assert.deepEqual(f.pct, cp.pct);
  });

  it("writes the 'top X%' as the complement of the beaten share", () => {
    const text = summarizeCheckpoint(cp);
    assert.match(text, /조회수 10,226 \(상위 9%\)/);
    assert.match(text, /구독 전환 0\.29 \(상위 39%\)/);
    assert.match(text, /기존 영상 대비 최상위권/);
  });

  it("never prints 'top 0%'", () => {
    assert.match(summarizeCheckpoint({ ...cp, pct: { views: 100 } }), /상위 1%/);
  });
});

describe("learnFromLevers", () => {
  const ev = (levers: string[], latestPct: Evaluated["latestPct"]) => ({ levers, latestPct }) as unknown as Evaluated;

  it("averages each lever's target metric and sorts best first", () => {
    const rows = learnFromLevers([
      ev(["pinned_vote", "sunday"], { cta: 70, views: 90 }),
      ev(["pinned_vote"], { cta: 30, views: 10 }),
    ]);
    assert.deepEqual(
      rows.map((r) => [r.lever, r.metric, r.videos, r.avgPct]),
      [
        ["일요일 업로드", "views", 1, 90],
        ["고정 댓글 투표", "cta", 2, 50],
      ],
    );
  });

  it("skips levers that were never tried or have no result yet", () => {
    assert.deepEqual(learnFromLevers([ev(["sunday"], undefined), ev([], { views: 80 })]), []);
  });
});

describe("trackedForAI", () => {
  afterEach(() => mock.restoreAll());

  it("builds the compact prompt payload from recorded results without any API call", async () => {
    let calls = 0;
    mock.method(globalThis, "fetch", async () => {
      calls++;
      throw new Error("network must not be used in this test");
    });
    const e: TrackEntry = {
      videoId: "abcdefghijk",
      title: "서열 1위의 굴욕",
      publishedAt: new Date(Date.now() - 30 * DAY).toISOString(),
      format: "short",
      levers: ["ending_cta"],
      ideaTitle: "공식 서열",
      linkedAt: new Date().toISOString(),
      frozen: {
        "1": frozen(2000, { views: 40, cvr: 55 }, 0.2),
        "3": frozen(3000, { views: 60, cvr: 50 }, 0.25),
        "7": frozen(5000, { views: 91, cvr: 45 }, 0.3),
        "28": frozen(9000, { views: 70, cvr: 40 }, 0.35),
      },
    };
    const out = await trackedForAI([e], null);
    assert.equal(calls, 0);
    assert.equal(out.videos.length, 1);
    assert.deepEqual(out.videos[0].leversTried, ["엔딩 CTA 카드"]); // ids are translated to labels
    assert.equal(out.videos[0].checkpoints.length, 4);
    assert.equal(out.videos[0].checkpoints[2].beatsPctOfMyPastVideos?.views, 91);
    assert.equal(out.leverSummary[0].lever, "엔딩 CTA 카드");
    assert.equal(out.leverSummary[0].avgPct, 40); // the latest checkpoint (day 28), and it targets conversion not views
  });
});
