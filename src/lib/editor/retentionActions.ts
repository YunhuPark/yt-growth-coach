// From a reading of the retention curve to things that can be done in the editor, in seconds of the source video. Pure.

import type { Removal, Seg } from "./cutPlan";
import type { Span } from "./retention";

/** Seconds of a span, or null when the length of the video is not known. */
export function spanSeconds(span: Span, durationSec: number | null): Seg | null {
  if (span.fromSec === null || span.toSec === null) return null;
  const start = Math.max(0, span.fromSec);
  const end = durationSec !== null ? Math.min(durationSec, span.toSec) : span.toSec;
  return end > start ? { start, end } : null;
}

/** The stretch to watch to see what happened at a drop: a few seconds before and after it. */
export function previewRange(span: Span, durationSec: number | null, around = 3): Seg | null {
  const s = spanSeconds(span, durationSec);
  if (!s) return null;
  return { start: Math.max(0, s.start - around), end: durationSec !== null ? Math.min(durationSec, s.end + around) : s.end + around };
}

export const SHORT_LENGTHS = [15, 30, 45, 60] as const;

/**
 * A Short from a place viewers went back to: it starts a moment before the rise (what they rewound to) and runs for `length`
 * seconds, kept inside the video. Null when the video is too short for it to be worth making (under 8 s).
 */
export function shortFromRewatch(span: Span, durationSec: number | null, length: number): Seg | null {
  const s = spanSeconds(span, durationSec);
  if (!s || durationSec === null) return null;
  const start = Math.max(0, Math.min(s.start - 2, durationSec - length)); // near the end, start earlier so the Short keeps its length
  const end = Math.min(durationSec, start + length);
  return end - start >= 8 ? { start, end } : null;
}

/** The drops to cut out, as removals the cut planner understands. */
export function removalsFromCliffs(cliffs: Span[], durationSec: number | null): Removal[] {
  const out: Removal[] = [];
  cliffs.forEach((c, i) => {
    const s = spanSeconds(c, durationSec);
    if (s) out.push({ id: `cliff:${i}`, start: s.start, end: s.end, kind: "silence" });
  });
  return out;
}
