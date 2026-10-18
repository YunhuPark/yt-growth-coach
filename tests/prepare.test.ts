import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { SavedPack, SavedRec } from "../src/lib/flows";
import { RETRY_COOLDOWN_MS, runPrepare, runWeeklyIfDue, startPrepare, type PrepDeps, type PrepOptions, type PrepStep, type WeeklyDeps } from "../src/lib/prepare";
import type { Idea } from "../src/lib/recommend";
import type { PrepRecord, Weekly } from "../src/lib/store";

const idea = (n: number): Idea => ({
  format: n % 2 ? "short" : "long",
  title: `아이디어 ${n}`,
  hook: "훅",
  outline: ["a"],
  cta: "구독",
  why: "근거",
  basedOn: "my_channel",
  confidence: "medium",
});

const rec = (count: number, goal = ""): SavedRec =>
  ({ at: "t", goal, result: { ideas: Array.from({ length: count }, (_, i) => idea(i + 1)) } }) as unknown as SavedRec;

/** Fake dependencies that record what was called, with switches for making each step fail. */
function fakes(over: Partial<PrepDeps> = {}) {
  const calls: string[] = [];
  const saved: PrepRecord[] = [];
  const notes: { title: string; text: string }[] = [];
  let recommendGoal: string | undefined;
  const deps: PrepDeps = {
    analysis: async () => void calls.push("analysis"),
    trends: async () => void calls.push("trends"),
    lastGoal: async () => "지난번 목표",
    recommend: async (o) => {
      calls.push("recommend");
      recommendGoal = o.goal;
      return rec(5);
    },
    makePack: async (i) => {
      calls.push(`pack:${i.title}`);
      return { at: "t", idea: i, pack: {} } as unknown as SavedPack;
    },
    sources: async (i) => {
      calls.push(`sources:${i.title}`);
      return { queries: [], scene: "", videos: [{}, {}], commentsAvailable: false } as never;
    },
    save: async (r) => void saved.push(r),
    notify: async (title, text) => void notes.push({ title, text }),
    now: () => new Date("2026-10-18T09:00:00Z"),
    ...over,
  };
  return { deps, calls, saved, notes, goal: () => recommendGoal };
}

const manual: PrepOptions = { trigger: "manual" };
const failing = (what: string) => async () => {
  throw new Error(`${what} 실패`);
};

describe("runPrepare", () => {
  it("runs every step in order and makes packages for the top two ideas by default", async () => {
    const f = fakes();
    const r = await runPrepare(manual, f.deps);
    assert.equal(r.status, "done");
    assert.deepEqual(f.calls, ["analysis", "trends", "recommend", "pack:아이디어 1", "pack:아이디어 2", "sources:아이디어 1"]);
    assert.ok(r.steps.every((s) => s.status === "done"));
    assert.deepEqual(r.record!.packages, ["아이디어 1", "아이디어 2"]);
    assert.equal(r.record!.ideas.length, 5);
    assert.equal(r.record!.sourcesFor, "아이디어 1");
  });

  it("limits the package count to 1-3", async () => {
    for (const [asked, made] of [[0, 1], [3, 3], [9, 3]] as const) {
      const f = fakes();
      await runPrepare({ ...manual, packages: asked }, f.deps);
      assert.equal(f.calls.filter((c) => c.startsWith("pack:")).length, made, `asked ${asked}`);
    }
  });

  it("reuses the last goal unless one is given", async () => {
    const a = fakes();
    await runPrepare(manual, a.deps);
    assert.equal(a.goal(), "지난번 목표");
    const b = fakes();
    await runPrepare({ ...manual, goal: "새 목표" }, b.deps);
    assert.equal(b.goal(), "새 목표");
  });

  it("stops when the channel data cannot be loaded and skips everything after it", async () => {
    const f = fakes({ analysis: failing("분석") });
    const r = await runPrepare(manual, f.deps);
    assert.equal(r.status, "error");
    assert.match(r.error!, /분석 실패/);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(r.steps.map((s) => s.status), ["failed", "skipped", "skipped", "skipped", "skipped"]);
    assert.equal(f.saved.length, 0);
    assert.equal(f.notes.length, 0, "nothing to announce when nothing was prepared");
  });

  it("stops when the recommendation fails, since packages need ideas", async () => {
    const f = fakes({ recommend: failing("추천") });
    const r = await runPrepare(manual, f.deps);
    assert.equal(r.status, "error");
    assert.deepEqual(r.steps.map((s) => s.status), ["done", "done", "failed", "skipped", "skipped"]);
    assert.ok(!f.calls.some((c) => c.startsWith("pack:")));
  });

  it("carries on when the trends step fails", async () => {
    const f = fakes({ trends: failing("트렌드") });
    const r = await runPrepare(manual, f.deps);
    assert.equal(r.status, "done");
    assert.equal(r.steps[1].status, "failed");
    assert.equal(r.steps[2].status, "done");
    assert.equal(r.record!.packages.length, 2);
  });

  it("keeps the packages that worked when one fails, and reports which", async () => {
    const f = fakes({
      makePack: async (i) => {
        if (i.title === "아이디어 1") throw new Error("패키지 실패");
        return { at: "t", idea: i, pack: {} } as unknown as SavedPack;
      },
    });
    const r = await runPrepare({ ...manual, packages: 3 }, f.deps);
    assert.equal(r.status, "done");
    assert.deepEqual(r.record!.packages, ["아이디어 2", "아이디어 3"]);
    const packages = r.steps.find((s) => s.key === "packages")!;
    assert.equal(packages.status, "done");
    assert.match(packages.detail!, /2\/3개 완료/);
    assert.match(packages.detail!, /패키지 실패/);
  });

  it("marks the package step failed when none could be made", async () => {
    const f = fakes({ makePack: failing("패키지") });
    const r = await runPrepare(manual, f.deps);
    assert.equal(r.steps.find((s) => s.key === "packages")!.status, "failed");
    assert.equal(r.status, "done", "the recommendation itself is still usable");
  });

  it("does not stop for a failed source lookup, and can skip it", async () => {
    const failed = await runPrepare(manual, fakes({ sources: failing("소재") }).deps);
    assert.equal(failed.status, "done");
    assert.equal(failed.steps.find((s) => s.key === "sources")!.status, "failed");
    assert.equal(failed.record!.sourcesFor, undefined);

    const f = fakes();
    const skipped = await runPrepare({ ...manual, sources: false }, f.deps);
    assert.equal(skipped.steps.find((s) => s.key === "sources")!.status, "skipped");
    assert.ok(!f.calls.some((c) => c.startsWith("sources:")));
  });

  it("skips packages and sources when the recommendation has no ideas", async () => {
    const f = fakes({ recommend: async () => rec(0) });
    const r = await runPrepare(manual, f.deps);
    assert.equal(r.status, "done");
    assert.deepEqual(r.steps.slice(3).map((s) => s.status), ["skipped", "skipped"]);
  });

  it("saves the record and announces the result, labelled by trigger", async () => {
    const a = fakes();
    await runPrepare(manual, a.deps);
    assert.equal(a.saved.length, 1);
    assert.equal(a.saved[0].trigger, "manual");
    assert.equal(a.notes[0].title, "원클릭 준비 완료");
    assert.match(a.notes[0].text, /아이디어 5개, 제작 패키지 2개/);

    const w = fakes();
    await runPrepare({ trigger: "weekly" }, w.deps);
    assert.equal(w.saved[0].trigger, "weekly");
    assert.equal(w.notes[0].title, "주간 준비 완료");
  });

  it("mentions failed steps in the announcement", async () => {
    const f = fakes({ trends: failing("트렌드") });
    await runPrepare(manual, f.deps);
    assert.match(f.notes[0].text, /실패한 단계 1개/);
  });

  it("reports progress after every step change", async () => {
    const seen: string[] = [];
    await runPrepare(manual, fakes().deps, (steps: PrepStep[]) => seen.push(steps.map((s) => s.status[0]).join("")));
    assert.ok(seen.length >= 10);
    assert.equal(seen.at(-1), "ddddd");
    assert.equal(seen[0], "rpppp"); // the first step is running, the rest pending
  });
});

describe("startPrepare", () => {
  beforeEach(() => {
    delete (globalThis as { __prep?: unknown }).__prep;
  });

  it("runs one preparation at a time and returns the running one to a second caller", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = fakes({ analysis: async () => void (await gate) });

    const first = startPrepare(manual, f.deps);
    const second = startPrepare(manual, f.deps);
    assert.equal(first.started, true);
    assert.equal(second.started, false);
    assert.equal(second.live, first.live);

    release();
    const { waitForPrepare } = await import("../src/lib/prepare");
    await waitForPrepare();
    assert.equal(first.live.status, "done");
    assert.equal(f.calls.filter((c) => c === "recommend").length, 1, "the work ran once, not twice");

    // After it finishes, a new run can start.
    assert.equal(startPrepare(manual, fakes().deps).started, true);
    await waitForPrepare();
  });
});

describe("runWeeklyIfDue", () => {
  // Sunday 2026-10-18 10:00 local time; the schedule is Sunday 09:00.
  const NOW = new Date(2026, 9, 18, 10, 0, 0);
  const weekly = (over: Partial<Weekly> = {}): Weekly => ({ enabled: true, day: 0, hour: 9, ...over });

  function weeklyFakes(opts: { weekly?: Weekly; lastRun?: Date; lastAttempt?: Date; startReturns?: boolean } = {}) {
    const attempts: string[] = [];
    const starts: PrepOptions[] = [];
    const deps: WeeklyDeps = {
      settings: async () => ({ weekly: opts.weekly ?? weekly() }),
      lastRun: async () => (opts.lastRun ? { at: opts.lastRun.toISOString() } : null),
      lastAttempt: async () => (opts.lastAttempt ? { at: opts.lastAttempt.toISOString() } : null),
      markAttempt: async (at) => void attempts.push(at),
      start: (o) => {
        starts.push(o);
        return { started: opts.startReturns ?? true };
      },
    };
    return { deps, attempts, starts };
  }

  it("starts the weekly preparation once a scheduled moment has passed since the last run", async () => {
    const f = weeklyFakes({ lastRun: new Date(2026, 9, 11, 9, 5) });
    assert.equal(await runWeeklyIfDue(NOW, f.deps), true);
    assert.deepEqual(f.starts, [{ trigger: "weekly" }]);
    assert.deepEqual(f.attempts, [NOW.toISOString()]);
  });

  it("does nothing when switched off or already run for this slot", async () => {
    const off = weeklyFakes({ weekly: weekly({ enabled: false }) });
    assert.equal(await runWeeklyIfDue(NOW, off.deps), false);
    assert.equal(off.starts.length, 0);

    const done = weeklyFakes({ lastRun: new Date(2026, 9, 18, 9, 2) });
    assert.equal(await runWeeklyIfDue(NOW, done.deps), false);
    assert.equal(done.attempts.length, 0);
  });

  it("does not retry within the cool-down after a failed or interrupted attempt", async () => {
    const lastRun = new Date(2026, 9, 11, 9, 5);
    const recent = weeklyFakes({ lastRun, lastAttempt: new Date(NOW.getTime() - 60 * 60_000) }); // an hour ago
    assert.equal(await runWeeklyIfDue(NOW, recent.deps), false);
    assert.equal(recent.starts.length, 0);

    const old = weeklyFakes({ lastRun, lastAttempt: new Date(NOW.getTime() - RETRY_COOLDOWN_MS - 60_000) });
    assert.equal(await runWeeklyIfDue(NOW, old.deps), true, "retries once the cool-down has passed");
  });

  it("does not start a second run while one is already in progress", async () => {
    const f = weeklyFakes({ lastRun: new Date(2026, 9, 11, 9, 5), startReturns: false });
    assert.equal(await runWeeklyIfDue(NOW, f.deps), false);
  });
});
