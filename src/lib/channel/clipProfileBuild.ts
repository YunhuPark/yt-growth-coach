import type { ClipProfile, ClipRef } from "../editor/clipProfile";
import { MIN_SHORTS_FOR_RANGE } from "../editor/clipProfile";
import type { PatternRow, Scored } from "./metrics";

// Boils the channel analysis down into the ClipProfile the editor asks for (see clipProfile.ts).

const ref = (v: Scored): ClipRef => ({
  title: v.title,
  durationSec: v.durationSec,
  score: Math.round(v.score ?? 0),
  viewsPerDay: Math.round(v.viewsPerDay),
  retentionPct: v.avgViewPct !== undefined ? Math.round(v.avgViewPct) : undefined,
  cvrPer1k: v.cvrPer1k !== undefined ? Math.round(v.cvrPer1k * 100) / 100 : undefined,
});

/** Linear-interpolated percentile (0-100) of an ascending-sorted list. */
const percentile = (sorted: number[], p: number) => {
  if (sorted.length === 1) return sorted[0];
  const i = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(sorted.length - 1, lo + 1)] - sorted[lo]) * (i - lo);
};

export function buildClipProfile(scored: Scored[], patterns: PatternRow[] = []): ClipProfile | null {
  const shorts = scored.filter((v) => v.format === "short" && v.score !== null).sort((a, b) => b.score! - a.score!);
  if (shorts.length < 3) return null; // too little to say anything useful

  let lengthRange: ClipProfile["lengthRange"] = null;
  if (shorts.length >= MIN_SHORTS_FOR_RANGE) {
    const topThird = shorts.slice(0, Math.max(3, Math.ceil(shorts.length / 3))).map((v) => v.durationSec).sort((a, b) => a - b);
    // Rounded outward to whole seconds so a clip of exactly the best length counts as inside
    lengthRange = { min: Math.floor(percentile(topThird, 25)), max: Math.ceil(percentile(topThird, 75)) };
  }

  const notes = patterns
    .filter((p) => /쇼츠|제목/.test(p.feature + p.bucket) && p.n >= 3 && Math.abs(p.lift) >= 8)
    .slice(0, 6)
    .map((p) => `${p.bucket}: 중앙 점수 ${p.lift > 0 ? "+" : ""}${p.lift} (n=${p.n})`);

  return {
    rated: shorts.length,
    best: shorts.slice(0, 5).map(ref),
    worst: shorts.slice(-3).reverse().map(ref),
    lengthRange,
    notes,
  };
}
