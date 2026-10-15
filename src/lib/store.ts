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

export type Settings = {
  regionCode: string; // e.g. "KR"
  categoryId: string; // YouTube videoCategoryId, "" = all
  competitors: string[]; // @handles or channel IDs (UC...)
  keywords: string[]; // niche keywords for trend search
};

export const DEFAULT_SETTINGS: Settings = {
  regionCode: "KR",
  categoryId: "",
  competitors: [],
  keywords: [],
};

export const loadSettings = async (): Promise<Settings> => ({
  ...DEFAULT_SETTINGS,
  ...(await readJson<Partial<Settings>>("settings.json", {})),
});
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
};
export const loadTracking = () => readJson<TrackEntry[]>("tracking.json", []);
export const saveTracking = (t: TrackEntry[]) => writeJson("tracking.json", t);

export type BaselineFile = {
  at: string;
  n: number; // videos used
  byN: Record<string, { views: number[]; cvr: number[]; cta: number[]; ret: number[] }>;
};
export const loadBaseline = () => readJson<BaselineFile | null>("baseline.json", null);
export const saveBaseline = (b: BaselineFile) => writeJson("baseline.json", b);
