import type { VideoStat } from "../src/lib/youtube";

/** Fixed "now" so age-dependent logic is deterministic. */
export const NOW = Date.parse("2026-10-16T00:00:00Z");
export const DAY = 86400_000;

export const daysAgo = (d: number, now = NOW) => new Date(now - d * DAY).toISOString();

export function video(i: number, over: Partial<VideoStat> = {}): VideoStat {
  return {
    id: `v${i}`,
    title: `영상 ${i}`,
    publishedAt: daysAgo(30 + i),
    durationSec: 20,
    format: "short",
    views: 1000,
    likes: 50,
    comments: 5,
    ...over,
  };
}
