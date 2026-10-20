import { promises as fs } from "node:fs";
import path from "node:path";

// Single-user, local-only storage. Tokens and settings live in .data/ (gitignored).
const DIR = path.join(process.cwd(), ".data");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path.join(DIR, file), "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, file), JSON.stringify(data, null, 2), "utf8");
}

export type Tokens = {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
};

export const loadTokens = () => readJson<Tokens | null>("tokens.json", null);
export const saveTokens = (t: Tokens) => writeJson("tokens.json", t);
export async function clearTokens() {
  await fs.rm(path.join(DIR, "tokens.json"), { force: true });
}

/** Weekly auto-preparation: the day (0 = Sunday) and hour (0-23, this computer's local time) to run. */
export type Weekly = {
  enabled: boolean;
  day: number;
  hour: number;
  /** when it was switched on; the first run waits for the next scheduled moment instead of firing immediately */
  since?: string;
};

export type Settings = {
  regionCode: string; // e.g. "KR"
  categoryId: string; // YouTube videoCategoryId, "" = all
  competitors: string[]; // @handles or channel IDs (UC...)
  keywords: string[]; // niche keywords for trend search
  weekly: Weekly;
};

export const DEFAULT_SETTINGS: Settings = {
  regionCode: "KR",
  categoryId: "",
  competitors: [],
  keywords: [],
  weekly: { enabled: false, day: 0, hour: 9 },
};

export const loadSettings = async (): Promise<Settings> => {
  const saved = await readJson<Partial<Settings>>("settings.json", {});
  return { ...DEFAULT_SETTINGS, ...saved, weekly: { ...DEFAULT_SETTINGS.weekly, ...saved.weekly } };
};
export const saveSettings = (s: Settings) => writeJson("settings.json", s);

export type SavedRecommendation = { at: string; goal: string; result: unknown };
export const loadRecommendation = () => readJson<SavedRecommendation | null>("recommendation.json", null);
export const saveRecommendation = (r: SavedRecommendation) => writeJson("recommendation.json", r);

export type SavedPackage = { at: string; idea: unknown; pack: unknown };
export const loadPackages = () => readJson<Record<string, SavedPackage>>("packages.json", {});
export const savePackages = (p: Record<string, SavedPackage>) => writeJson("packages.json", p);

export type TrackEntry = {
  videoId: string;
  title: string;
  publishedAt: string;
  format: "short" | "long";
  ideaTitle?: string;
  levers: string[];
  note?: string;
  linkedAt: string;
  /** added by the collector when it noticed a new upload (levers can be edited later) */
  auto?: boolean;
  /** results frozen the first time each checkpoint became final, keyed by day count ("1", "3", "7") */
  frozen?: Record<string, FrozenResult>;
};
export type FrozenResult = {
  at: string;
  views: number;
  cvr?: number;
  cta?: number;
  ret?: number;
  /** share of my past videos beaten, by metric */
  pct: Record<string, number>;
};
export const loadTracking = () => readJson<TrackEntry[]>("tracking.json", []);
export const saveTracking = (t: TrackEntry[]) => writeJson("tracking.json", t);

export type BaselineSet = {
  n: number; // videos used
  byN: Record<string, { views: number[]; cvr: number[]; cta: number[]; ret: number[] }>;
};
/** Shorts and long-form are measured separately: their view curves and retention are not comparable. */
export type BaselineFile = {
  at: string;
  sets: Partial<Record<"short" | "long", BaselineSet>>;
  /** read from the old single-pool format; rebuilt on the next collection */
  legacy?: boolean;
};
type LegacyBaseline = { at: string; n: number; byN: BaselineSet["byN"] };

export async function loadBaseline(): Promise<BaselineFile | null> {
  const raw = await readJson<BaselineFile | LegacyBaseline | null>("baseline.json", null);
  if (!raw) return null;
  if ("sets" in raw) return raw;
  // Before long-form support the baseline was one pool built from a shorts-only channel: treat it as the shorts set.
  return { at: raw.at, sets: { short: { n: raw.n, byN: raw.byN } }, legacy: true };
}
export const saveBaseline = (b: BaselineFile) => writeJson("baseline.json", b);

export type CollectorState = {
  lastRunAt?: string;
  lastError?: string;
  lastResult?: { newVideos: number; newEvents: number; checked: number };
  /** video ids already seen, so only genuinely new uploads trigger tracking */
  seen?: string[];
};
export const loadCollector = () => readJson<CollectorState>("collector.json", {});
export const saveCollector = (c: CollectorState) => writeJson("collector.json", c);

export type CollectEvent = {
  id: string;
  at: string;
  type: "new_video" | "checkpoint" | "prepared";
  videoId: string;
  title: string;
  n?: number;
  text: string;
  read: boolean;
};
export const loadEvents = () => readJson<CollectEvent[]>("events.json", []);
export const saveEvents = (e: CollectEvent[]) => writeJson("events.json", e.slice(0, 200));

/** Whether YouTube treats a video as a Short, by video id. A video never changes, so answers are kept for good. */
export const loadShortsCache = () => readJson<Record<string, boolean>>("shorts.json", {});
export const saveShortsCache = (c: Record<string, boolean>) => writeJson("shorts.json", c);

/** The outcome of the last "one-click preparation" run, kept so the page can show it after a reload. */
export type PrepRecord = {
  at: string;
  trigger: "manual" | "weekly";
  steps: { key: string; label: string; status: "done" | "skipped" | "failed"; detail?: string }[];
  ideas: string[]; // titles of the recommended ideas
  packages: string[]; // titles that got a production package
  sourcesFor?: string;
};
export const loadPrep = () => readJson<PrepRecord | null>("prep.json", null);
export const savePrep = (r: PrepRecord) => writeJson("prep.json", r);

/** When the weekly job last tried to run, successful or not, so a failing run isn't retried every few minutes. */
export const loadPrepAttempt = () => readJson<{ at: string } | null>("prep-attempt.json", null);
export const savePrepAttempt = (a: { at: string }) => writeJson("prep-attempt.json", a);

/** A Short rendered from an AI candidate, kept so it can be linked to the video it became. */
export type ClipRecord = {
  id: string; // the render id
  at: string;
  sourceName: string;
  aiScore: number; // 1-10
  reason: string;
  title: string;
  hook: string;
  start: number;
  end: number;
  lengthFit?: "within" | "shorter" | "longer" | null;
  videoId?: string;
  linkedAt?: string;
};
export const loadClips = () => readJson<ClipRecord[]>("clips.json", []);
export const saveClips = (c: ClipRecord[]) => writeJson("clips.json", c);
