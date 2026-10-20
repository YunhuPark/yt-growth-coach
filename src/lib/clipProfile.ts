import type { PatternRow, Scored } from "./metrics";

// What has worked on this channel, boiled down for the clip finder: the Shorts that scored best and worst, and the length
// range the best ones share. It only describes the creator's own past results; it says nothing about the video being cut.

export type ClipProfile = {
  /** Shorts with a quality score (7+ days old, enough data) */
  rated: number;
  best: ClipRef[];
  worst: ClipRef[];
  /** length range (seconds) shared by the top third of rated Shorts; null until there are enough of them */
  lengthRange: { min: number; max: number } | null;
  /** short pattern findings, e.g. "쇼츠 30–59초: 중앙 점수 +12 (n=6)" */
  notes: string[];
};

export type ClipRef = {
  title: string;
  durationSec: number;
  score: number;
  viewsPerDay: number;
  retentionPct?: number;
  cvrPer1k?: number;
};

export const MIN_SHORTS_FOR_RANGE = 6;

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

export type LengthFit = "within" | "shorter" | "longer";

/** How a clip's length compares with the range the channel's best Shorts share. */
export function lengthFit(seconds: number, profile: ClipProfile | null | undefined): LengthFit | null {
  const r = profile?.lengthRange;
  if (!r) return null;
  return seconds < r.min ? "shorter" : seconds > r.max ? "longer" : "within";
}

export function describeProfile(p: ClipProfile): string {
  const line = (c: ClipRef) =>
    `- "${c.title}" ${Math.round(c.durationSec)}초 · 점수 ${c.score} · 하루 조회 ${c.viewsPerDay}` +
    (c.retentionPct !== undefined ? ` · 지속률 ${c.retentionPct}%` : "") +
    (c.cvrPer1k !== undefined ? ` · 구독전환 ${c.cvrPer1k}/천회` : "");
  return [
    `이 채널의 쇼츠 성과(참고 자료, 점수 ${p.rated}개 기준):`,
    p.lengthRange ? `잘된 쇼츠의 길이 범위: ${p.lengthRange.min}~${p.lengthRange.max}초` : "",
    "잘된 쇼츠:",
    ...p.best.map(line),
    "부진한 쇼츠:",
    ...p.worst.map(line),
    p.notes.length ? `패턴: ${p.notes.join(" / ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
