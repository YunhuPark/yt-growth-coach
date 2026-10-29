// The three generation steps (recommend, package, source lookup) as plain functions, so the buttons in the
// UI, the one-click preparation, and the weekly job all run exactly the same code.
import { getAnalysis, getTrends } from "./analysis";
import { makeAnyPackage, type AnyPack } from "./package";
import { recommend, type Idea, type Recommendation } from "./recommend";
import { findSources, type SourceResult } from "./sources";
import { topHashtags } from "./discover";
import {
  loadBaseline,
  loadPackages,
  loadRecommendation,
  loadSettings,
  loadTracking,
  savePackages,
  saveRecommendation,
} from "../shared/store";
import { trackedForAI } from "./tracking";
import { tracked } from "../shared/usage";

export type SavedRec = { at: string; goal: string; result: Recommendation };
export type SavedPack = { at: string; idea: Idea; pack: AnyPack };

export async function generateRecommendation(opts: { goal?: string; useTrends?: boolean } = {}): Promise<SavedRec> {
  const a = await getAnalysis();
  const trends = opts.useTrends === false ? null : await getTrends().catch(() => null);
  const goal = opts.goal?.slice(0, 200) ?? "";
  const entries = await loadTracking();
  const trackedResults = entries.length ? await trackedForAI(entries, await loadBaseline()) : undefined;
  const result = await tracked("recommend", () => recommend({
    channel: { title: a.channel.title, subscribers: a.channel.subscribers, videoCount: a.channel.videoCount },
    scored: a.videos,
    patterns: a.patterns,
    trends,
    goal,
    tracked: trackedResults,
  }));
  const saved = { at: new Date().toISOString(), goal, result };
  await saveRecommendation(saved);
  return saved;
}

export async function generatePackage(idea: Idea): Promise<SavedPack> {
  const a = await getAnalysis();
  const rec = (await loadRecommendation())?.result as { actions?: { kind: string; title: string; how: string }[] } | undefined;
  const actions = (rec?.actions ?? []).slice(0, 7).map((x) => `[${x.kind}] ${x.title} — ${x.how}`);

  const pack = await tracked("package", () =>
    makeAnyPackage({
      idea,
      channelTitle: a.channel.title,
      scored: a.videos,
      patterns: a.patterns,
      actions,
    }),
  );
  const all = await loadPackages();
  const saved = { at: new Date().toISOString(), idea, pack };
  all[idea.title] = saved;
  await savePackages(all);
  return saved;
}

// Each lookup costs ~600 YouTube quota units, so results are kept for an hour per idea.
const g = globalThis as unknown as { __sources?: Map<string, { at: number; value: SourceResult }> };
const sourceCache = (g.__sources ??= new Map());

export async function lookupSources(idea: Idea, refresh = false): Promise<SourceResult> {
  const hit = sourceCache.get(idea.title);
  if (!refresh && hit && Date.now() - hit.at < 60 * 60_000) return hit.value;

  const a = await getAnalysis();
  const { regionCode } = await loadSettings();
  const value = await tracked("sources", () => findSources(idea, topHashtags(a.videos).map((h) => h.tag), regionCode, a.channel.id));
  if (value.videos.length) sourceCache.set(idea.title, { at: Date.now(), value }); // don't pin an empty result
  return value;
}
