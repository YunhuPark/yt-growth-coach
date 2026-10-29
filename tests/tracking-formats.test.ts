// Hermetic: runs inside a temp working directory with a fake login file and a stubbed fetch, so it never
// touches the real .data/ folder or the network. Modules are imported only after chdir because the storage
// folder is resolved from process.cwd() when store.ts loads.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import type { Scored } from "../src/lib/channel/metrics";
import type { BaselineFile, BaselineSet, TrackEntry } from "../src/lib/shared/store";

const DAY = 86400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

let tracking: typeof import("../src/lib/channel/tracking");
let store: typeof import("../src/lib/shared/store");
let tmp: string;
const originalCwd = process.cwd();
let analyticsCalls = 0;

/** 30 days of identical daily rows starting at the requested start date, like Analytics returns for a video. */
function analyticsResponse(startDate: string) {
  const start = Date.parse(startDate);
  const rows = Array.from({ length: 30 }, (_, i) => [new Date(start + i * DAY).toISOString().slice(0, 10), 1000, 60, 2, 3, 1]);
  return {
    columnHeaders: ["day", "views", "averageViewPercentage", "subscribersGained", "comments", "shares"].map((name) => ({ name })),
    rows,
  };
}

before(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), "ytgc-"));
  mkdirSync(path.join(tmp, ".data"));
  writeFileSync(
    path.join(tmp, ".data", "tokens.json"),
    JSON.stringify({ access_token: "fake", refresh_token: "fake", expires_at: Date.now() + 3600_000 }),
  );
  process.chdir(tmp);
  store = await import("../src/lib/shared/store");
  tracking = await import("../src/lib/channel/tracking");
});

after(() => {
  process.chdir(originalCwd);
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  analyticsCalls = 0;
  mock.method(globalThis, "fetch", async (input: unknown) => {
    analyticsCalls++;
    const startDate = new URL(String(input)).searchParams.get("startDate") ?? new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(analyticsResponse(startDate)), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});

// A baseline set whose every checkpoint has `n` past videos with values 1..n.
const setOf = (n: number): BaselineSet => {
  const arr = Array.from({ length: n }, (_, i) => i + 1);
  const cp = { views: arr, cvr: arr, cta: arr, ret: arr };
  return { n, byN: { "1": cp, "3": cp, "7": cp, "28": cp } };
};

const entry = (format: "short" | "long", ageDays: number): TrackEntry => ({
  videoId: "abcdefghijk",
  title: "테스트",
  publishedAt: ago(ageDays),
  format,
  levers: [],
  linkedAt: new Date().toISOString(),
});

describe("baselines are kept per format", () => {
  it("compares a long-form video only with long-form history", async () => {
    const baseline: BaselineFile = { at: new Date().toISOString(), sets: { short: setOf(50), long: setOf(8) } };
    const ev = await tracking.evaluate(entry("long", 10), baseline, true);
    assert.equal(ev.compared, true);
    assert.ok(ev.checkpoints.find((c) => c.n === 7)!.pct?.views !== undefined);
  });

  it("does not rank a long video against shorts when there is no long-form history", async () => {
    const baseline: BaselineFile = { at: new Date().toISOString(), sets: { short: setOf(50) } };
    const ev = await tracking.evaluate(entry("long", 10), baseline, true);
    assert.equal(ev.compared, false);
    assert.equal(ev.latestPct, undefined);
    assert.match(ev.verdict, /롱폼 기록이 부족/);
    // The raw numbers are still reported, just without a ranking.
    assert.ok(ev.checkpoints.find((c) => c.n === 7)!.cum!.views > 0);
  });

  it("does the same for a short when only long-form history exists", async () => {
    const baseline: BaselineFile = { at: new Date().toISOString(), sets: { long: setOf(8) } };
    const ev = await tracking.evaluate(entry("short", 10), baseline, true);
    assert.equal(ev.compared, false);
    assert.match(ev.verdict, /쇼츠 기록이 부족/);
  });

  it("ignores a checkpoint whose history is too thin to rank against", async () => {
    // Five videos in total, but only two old enough to have a day-28 result.
    const thin = setOf(5);
    thin.byN["28"] = { views: [1, 2], cvr: [1, 2], cta: [1, 2], ret: [1, 2] };
    const baseline: BaselineFile = { at: new Date().toISOString(), sets: { long: thin } };
    const ev = await tracking.evaluate(entry("long", 40), baseline, true);
    assert.equal(ev.checkpoints.find((c) => c.n === 28)!.pct?.views, undefined);
    assert.ok(ev.checkpoints.find((c) => c.n === 7)!.pct?.views !== undefined);
  });
});

describe("buildBaseline", () => {
  const vid = (i: number, format: "short" | "long", ageDays: number) =>
    ({ id: `vid${String(i).padStart(8, "0")}`, publishedAt: ago(ageDays), format }) as unknown as Scored;

  it("builds a set per format, skips formats with fewer than 5 videos, and leaves young videos out of later checkpoints", async () => {
    const videos = [
      ...Array.from({ length: 6 }, (_, i) => vid(i, "short", 60 + i)),
      ...Array.from({ length: 4 }, (_, i) => vid(100 + i, "long", 60 + i)), // too few for a long set
      vid(200, "short", 12), // old enough for days 1-7 but not for day 28
    ];
    const file = await tracking.buildBaseline(videos);
    assert.equal(file.sets.long, undefined);
    const shorts = file.sets.short!;
    assert.equal(shorts.n, 7);
    assert.equal(shorts.byN["7"].views.length, 7);
    assert.equal(shorts.byN["28"].views.length, 6); // the 12-day-old video can't speak for day 28
    assert.ok(analyticsCalls >= 10, "one Analytics call per video");
  });
});

describe("loading and refreshing a baseline", () => {
  it("reads the old single-pool file as the shorts set and flags it for a rebuild", async () => {
    writeFileSync(
      path.join(tmp, ".data", "baseline.json"),
      JSON.stringify({ at: new Date().toISOString(), n: 6, byN: setOf(6).byN }),
    );
    const b = (await store.loadBaseline())!;
    assert.equal(b.legacy, true);
    assert.equal(b.sets.short!.n, 6);
    assert.equal(b.sets.long, undefined);
  });

  it("rebuilds a legacy or day-28-less baseline but reuses a current one", async () => {
    const videos = Array.from({ length: 6 }, (_, i) => ({ id: `vid${String(i).padStart(8, "0")}`, publishedAt: ago(60 + i), format: "short" })) as unknown as Scored[];

    // legacy -> rebuilt
    await tracking.getBaseline(videos);
    assert.ok(analyticsCalls > 0, "legacy baseline should trigger a rebuild");

    // now current -> reused without any API call
    analyticsCalls = 0;
    const again = await tracking.getBaseline(videos);
    assert.equal(analyticsCalls, 0);
    assert.equal(again.legacy, undefined);
    assert.ok(again.sets.short!.byN["28"]);
  });
});
