import { patternInsights, scoreVideos, summarize } from "./metrics";
import { loadSettings } from "./store";
import { loadTrends, type TrendData } from "./trends";
import { loadMyChannel } from "./youtube";

// In-memory caches keep repeated dashboard loads from burning API quota.
// Next dev can reload modules, so stash them on globalThis.
const g = globalThis as unknown as {
  __ytCache?: Map<string, { at: number; value: unknown }>;
};
const cache = (g.__ytCache ??= new Map());

async function cached<T>(key: string, ttlMs: number, force: boolean, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function getAnalysis(force = false) {
  return cached("analysis", 10 * 60_000, force, async () => {
    const data = await loadMyChannel();
    const scored = scoreVideos(data.videos);
    return {
      channel: data.channel,
      notes: data.notes,
      videos: scored,
      patterns: patternInsights(scored),
      summary: summarize(scored),
    };
  });
}

export async function getTrends(force = false): Promise<TrendData> {
  const s = await loadSettings();
  return cached(`trends:${JSON.stringify(s)}`, 30 * 60_000, force, () => loadTrends(s));
}

export const clearCache = () => cache.clear();
