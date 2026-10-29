import { getAnalysis, getTrends } from "./analysis";
import { generatePackage, generateRecommendation, lookupSources, type SavedPack, type SavedRec } from "./flows";
import type { Idea } from "./recommend";
import type { SourceResult } from "./sources";
import { isDue } from "./schedule";
import {
  loadEvents,
  loadPrep,
  loadPrepAttempt,
  loadRecommendation,
  loadSettings,
  saveEvents,
  savePrep,
  savePrepAttempt,
  type PrepRecord,
  type Weekly,
} from "../shared/store";

export type StepKey = "analysis" | "trends" | "recommend" | "packages" | "sources";
export type StepStatus = "pending" | "running" | "done" | "skipped" | "failed";
export type PrepStep = { key: StepKey; label: string; status: StepStatus; detail?: string };

export type PrepOptions = {
  trigger: "manual" | "weekly";
  /** goal text for the recommendation; falls back to the goal used last time */
  goal?: string;
  /** how many of the top ideas get a production package (1-3, default 2) */
  packages?: number;
  /** also look up source-video candidates for the top idea (default true) */
  sources?: boolean;
};

export type PrepLive = {
  status: "running" | "done" | "error";
  steps: PrepStep[];
  startedAt: number;
  error?: string;
  record?: PrepRecord;
};

/** Everything that talks to YouTube, Claude, or the disk, so the orchestration can be tested without any of it. */
export type PrepDeps = {
  analysis: () => Promise<unknown>;
  trends: () => Promise<unknown>;
  lastGoal: () => Promise<string>;
  recommend: (o: { goal: string }) => Promise<SavedRec>;
  makePack: (idea: Idea) => Promise<SavedPack>;
  sources: (idea: Idea) => Promise<SourceResult>;
  save: (r: PrepRecord) => Promise<void>;
  notify: (title: string, text: string) => Promise<void>;
  now: () => Date;
};

export const realDeps: PrepDeps = {
  analysis: () => getAnalysis(true),
  trends: () => getTrends(),
  lastGoal: async () => (await loadRecommendation())?.goal ?? "",
  recommend: (o) => generateRecommendation({ goal: o.goal, useTrends: true }),
  makePack: generatePackage,
  sources: (idea) => lookupSources(idea),
  save: savePrep,
  notify: async (title, text) => {
    const at = new Date().toISOString();
    const events = await loadEvents();
    await saveEvents([{ id: `prepared:${at}`, at, type: "prepared", videoId: "", title, text, read: false }, ...events]);
  },
  now: () => new Date(),
};

const msg = (e: unknown) => (e instanceof Error ? e.message : "알 수 없는 오류").slice(0, 140);

/**
 * Runs the preparation: refresh the channel data, refresh the trends, ask for a recommendation, then build
 * production packages for the top ideas and look up source candidates for the first one.
 * The channel data and the recommendation are required; every other step may fail without stopping the rest.
 */
export async function runPrepare(opts: PrepOptions, deps: PrepDeps = realDeps, onUpdate?: (steps: PrepStep[]) => void): Promise<PrepLive> {
  const n = Math.min(3, Math.max(1, Math.round(opts.packages ?? 2)));
  const steps: PrepStep[] = [
    { key: "analysis", label: "채널 데이터 새로 불러오기", status: "pending" },
    { key: "trends", label: "트렌드 수집", status: "pending" },
    { key: "recommend", label: "AI 추천 만들기", status: "pending" },
    { key: "packages", label: `제작 패키지 만들기 (상위 ${n}개)`, status: "pending" },
    { key: "sources", label: "소재 후보 찾기 (1순위 아이디어)", status: "pending" },
  ];
  const live: PrepLive = { status: "running", steps, startedAt: deps.now().getTime() };
  const step = (key: StepKey) => steps.find((s) => s.key === key)!;
  const set = (key: StepKey, status: StepStatus, detail?: string) => {
    Object.assign(step(key), { status, detail });
    onUpdate?.(steps);
  };
  const fail = (e: unknown) => {
    live.status = "error";
    live.error = msg(e);
    return live;
  };

  set("analysis", "running");
  try {
    await deps.analysis();
    set("analysis", "done");
  } catch (e) {
    set("analysis", "failed", msg(e));
    for (const k of ["trends", "recommend", "packages", "sources"] as const) set(k, "skipped", "채널 데이터를 불러오지 못해 건너뜀");
    return fail(e);
  }

  set("trends", "running");
  try {
    await deps.trends();
    set("trends", "done");
  } catch (e) {
    set("trends", "failed", msg(e)); // the recommendation still works without trend data
  }

  set("recommend", "running");
  let rec: SavedRec;
  try {
    rec = await deps.recommend({ goal: opts.goal ?? (await deps.lastGoal()) });
    set("recommend", "done", `아이디어 ${rec.result.ideas.length}개`);
  } catch (e) {
    set("recommend", "failed", msg(e));
    set("packages", "skipped", "추천이 없어 건너뜀");
    set("sources", "skipped", "추천이 없어 건너뜀");
    return fail(e);
  }

  const ideas = rec.result.ideas;
  const made: string[] = [];
  if (!ideas.length) {
    set("packages", "skipped", "추천된 아이디어가 없음");
  } else {
    set("packages", "running");
    const notes: string[] = [];
    for (const idea of ideas.slice(0, n)) {
      try {
        await deps.makePack(idea);
        made.push(idea.title);
      } catch (e) {
        notes.push(`"${idea.title.slice(0, 20)}" 실패: ${msg(e)}`);
      }
    }
    // Some packages made counts as done (the detail says how many); none made counts as failed.
    set("packages", made.length ? "done" : "failed", `${made.length}/${Math.min(n, ideas.length)}개 완료${notes.length ? ` · ${notes.join(" · ")}` : ""}`);
  }

  let sourcesFor: string | undefined;
  if (opts.sources === false || !ideas[0]) {
    set("sources", "skipped", opts.sources === false ? "사용 안 함" : "아이디어가 없음");
  } else {
    set("sources", "running");
    try {
      const r = await deps.sources(ideas[0]);
      sourcesFor = ideas[0].title;
      set("sources", "done", `후보 영상 ${r.videos.length}개`);
    } catch (e) {
      set("sources", "failed", msg(e));
    }
  }

  const record: PrepRecord = {
    at: deps.now().toISOString(),
    trigger: opts.trigger,
    steps: steps.map((s) => ({ key: s.key, label: s.label, status: s.status === "pending" || s.status === "running" ? "skipped" : s.status, detail: s.detail })),
    ideas: ideas.map((i) => i.title),
    packages: made,
    sourcesFor,
  };
  await deps.save(record);
  const failedSteps = steps.filter((s) => s.status === "failed").length;
  await deps.notify(
    opts.trigger === "weekly" ? "주간 준비 완료" : "원클릭 준비 완료",
    `아이디어 ${ideas.length}개, 제작 패키지 ${made.length}개를 준비했습니다.${failedSteps ? ` (실패한 단계 ${failedSteps}개)` : ""}`,
  );
  live.record = record;
  live.status = "done";
  return live;
}

// One preparation at a time, whether it was started by the button, the weekly timer, or the CLI.
const g = globalThis as unknown as { __prep?: { live: PrepLive; done: Promise<PrepLive> } };

/** Starts a run in the background, or returns the one already running. */
export function startPrepare(opts: PrepOptions, deps: PrepDeps = realDeps): { live: PrepLive; started: boolean } {
  if (g.__prep && g.__prep.live.status === "running") return { live: g.__prep.live, started: false };
  const steps: PrepStep[] = [];
  const live: PrepLive = { status: "running", steps, startedAt: deps.now().getTime() };
  const done = runPrepare(opts, deps, (s) => {
    steps.length = 0;
    steps.push(...s.map((x) => ({ ...x })));
  })
    .then((final) => {
      Object.assign(live, { status: final.status, error: final.error, record: final.record });
      return live;
    })
    .catch((e) => {
      live.status = "error";
      live.error = msg(e);
      return live;
    });
  g.__prep = { live, done };
  return { live, started: true };
}

export const currentPrepare = () => g.__prep?.live ?? null;
/** Resolves when the current run (if any) has finished; used by the CLI. */
export const waitForPrepare = () => g.__prep?.done ?? Promise.resolve(null);

/** After a failed or interrupted weekly run, wait this long before trying again. */
export const RETRY_COOLDOWN_MS = 6 * 60 * 60_000;

export type WeeklyDeps = {
  settings: () => Promise<{ weekly: Weekly }>;
  lastRun: () => Promise<{ at: string } | null>;
  lastAttempt: () => Promise<{ at: string } | null>;
  markAttempt: (at: string) => Promise<void>;
  start: (opts: PrepOptions) => { started: boolean };
};

const realWeeklyDeps: WeeklyDeps = {
  settings: loadSettings,
  lastRun: loadPrep,
  lastAttempt: loadPrepAttempt,
  markAttempt: (at) => savePrepAttempt({ at }),
  start: (opts) => startPrepare(opts),
};

/**
 * Called on a timer (and by the CLI): starts the weekly preparation if a scheduled moment has passed since the
 * last run. Returns true when it started one.
 */
export async function runWeeklyIfDue(now = new Date(), deps: WeeklyDeps = realWeeklyDeps): Promise<boolean> {
  const { weekly } = await deps.settings();
  const last = await deps.lastRun();
  if (!isDue(now, last?.at, weekly)) return false;
  const attempt = await deps.lastAttempt();
  if (attempt && now.getTime() - Date.parse(attempt.at) < RETRY_COOLDOWN_MS) return false;
  await deps.markAttempt(now.toISOString());
  return deps.start({ trigger: "weekly" }).started;
}
