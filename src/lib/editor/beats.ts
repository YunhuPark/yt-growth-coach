// Working with the beat times of a piece of music: tempo, regularity, doubling and halving, shifting, picking every Nth beat and snapping
// a stretch of video to beats. Pure functions; where the beats come from is beatAnalysis.ts.

export type BeatMap = {
  /** beat times in seconds from the start of the video */
  beats: number[];
};

/** How strong the sound is along a stretch: one value per `stepSec`, the first starting at `fromSec` (seconds in the video). */
export type Loudness = { fromSec: number; stepSec: number; values: number[] };

/** The mean strength of the sound between two times; 0 where there is no data. */
export function loudnessBetween(l: Loudness, start: number, end: number): number {
  if (!l.values.length || l.stepSec <= 0) return 0;
  const a = Math.max(0, Math.floor((start - l.fromSec) / l.stepSec));
  const b = Math.min(l.values.length, Math.max(a + 1, Math.ceil((end - l.fromSec) / l.stepSec)));
  let sum = 0;
  let n = 0;
  for (let i = a; i < b; i++) {
    sum += l.values[i];
    n++;
  }
  return n ? sum / n : 0;
}

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const intervals = (beats: number[]) => beats.slice(1).map((b, i) => b - beats[i]);

/** Typical time between beats, in seconds (0 with fewer than two beats). */
export const beatPeriod = (beats: number[]): number => median(intervals(beats));

/** Beats per minute from the typical interval; 0 when it cannot be told. */
export function bpmOf(beats: number[]): number {
  const p = beatPeriod(beats);
  return p > 0 ? Math.round((60 / p) * 10) / 10 : 0;
}

/**
 * How evenly the beats are spaced, 0 to 1: the share of intervals within 12 % of the typical one. Music with a steady pulse is near
 * 1; a free-time or sparse piece is low, and then the beats are not worth trusting.
 */
export function regularity(beats: number[]): number {
  const iv = intervals(beats);
  if (iv.length < 3) return 0;
  const m = median(iv);
  if (m <= 0) return 0;
  return Math.round((iv.filter((x) => Math.abs(x - m) <= 0.12 * m).length / iv.length) * 100) / 100;
}

/** Twice the tempo (a beat added halfway between each two) or half of it (every other beat). The tracker often picks one octave off. */
export function scaleBeats(beats: number[], mode: "same" | "double" | "half"): number[] {
  if (mode === "same" || beats.length < 2) return [...beats];
  if (mode === "half") return beats.filter((_, i) => i % 2 === 0);
  const out: number[] = [];
  beats.forEach((b, i) => {
    out.push(b);
    if (i < beats.length - 1) out.push((b + beats[i + 1]) / 2);
  });
  // one more half-beat after the last, so the end is not left bare
  const p = beatPeriod(beats);
  if (p > 0) out.push(beats[beats.length - 1] + p / 2);
  return out.map((t) => Math.round(t * 1000) / 1000);
}

/** All beats moved by `offsetSec` (positive = later), dropping any that fall before 0. */
export const shiftBeats = (beats: number[], offsetSec: number): number[] => beats.map((b) => Math.round((b + offsetSec) * 1000) / 1000).filter((b) => b >= 0);

/** Every `n`th beat, starting from the `phase`th (0-based). */
export const everyNth = (beats: number[], n: number, phase = 0): number[] => beats.filter((_, i) => i >= phase && (i - phase) % Math.max(1, Math.round(n)) === 0);

/** The beat closest to a time, or null without beats. */
export function nearestBeat(t: number, beats: number[]): number | null {
  if (!beats.length) return null;
  let best = beats[0];
  for (const b of beats) if (Math.abs(b - t) < Math.abs(best - t)) best = b;
  return best;
}

/**
 * Moves the start and the end of a stretch onto the nearest beats, so the cut at each end falls on a beat and the length is a whole
 * number of beats. Keeps at least `minBeats` beats between them; unchanged when there are too few beats to snap to.
 */
export function snapToBeats(start: number, end: number, beats: number[], minBeats = 2): { start: number; end: number; beats: number } {
  const inside = (a: number, b: number) => beats.filter((x) => x >= a - 1e-6 && x <= b + 1e-6).length - 1;
  if (beats.length < minBeats + 1 || end <= start) return { start, end, beats: Math.max(0, inside(start, end)) };
  let s = nearestBeat(start, beats)!;
  let e = nearestBeat(end, beats)!;
  if (e <= s || inside(s, e) < minBeats) {
    // too close together after snapping: keep the start and take the beat `minBeats` after it
    const i = beats.indexOf(s);
    e = beats[Math.min(beats.length - 1, i + minBeats)];
    if (e <= s) {
      s = beats[Math.max(0, beats.length - 1 - minBeats)];
      e = beats[beats.length - 1];
    }
  }
  return { start: s, end: e, beats: Math.max(0, inside(s, e)) };
}

/** The beats inside [start, end], as times from `start`: what an effect list for a piece cut out of the video needs. */
export const beatsWithin = (beats: number[], start: number, end: number): number[] =>
  beats.filter((b) => b >= start - 1e-6 && b <= end + 1e-6).map((b) => Math.round((b - start) * 1000) / 1000);

/**
 * A short montage of a long stretch: pieces of `beatsPerPiece` beats, taken evenly across the stretch and joined. Every piece starts
 * and ends on a beat and starts on a multiple of its length from the first beat, so pieces never overlap, bars stay aligned, and the
 * pulse carries across the joins. A target at least as long as the stretch gives the whole stretch. Pieces are spread evenly, or the
 * loudest ones are taken (a chorus or a drop is usually louder than a verse), which then may be clustered.
 */
export function planBeatCuts(
  beats: number[],
  from: number,
  to: number,
  beatsPerPiece: number,
  targetSec: number,
  pick: { by: "even" } | { by: "loud"; loudness: Loudness } = { by: "even" },
): { start: number; end: number }[] {
  const k = Math.max(1, Math.round(beatsPerPiece));
  const b = beats.filter((x) => x >= from - 1e-6 && x <= to + 1e-6);
  const maxPieces = Math.floor((b.length - 1) / k);
  const period = beatPeriod(b);
  if (maxPieces < 1 || period <= 0) return [];
  const want = Math.max(1, Math.round(targetSec / (k * period)));
  const m = Math.min(want, maxPieces);
  let at: number[];
  if (pick.by === "loud" && m < maxPieces) {
    // the m strongest pieces (the earlier one wins a tie), shown in their original order
    const scored = Array.from({ length: maxPieces }, (_, a) => ({ a, v: loudnessBetween(pick.loudness, b[a * k], b[a * k + k]) }));
    scored.sort((x, y) => y.v - x.v || x.a - y.a);
    at = scored.slice(0, m).map((x) => x.a).sort((x, y) => x - y);
  } else {
    at = Array.from({ length: m }, (_, j) => (m === 1 ? 0 : Math.round((j * (maxPieces - 1)) / (m - 1))));
  }
  return at.map((a) => ({ start: b[a * k], end: b[a * k + k] }));
}

/** The beats as times in the joined result of `pieces`: each piece's beats from its start, the end beat left to the next piece. */
export function beatsInResult(pieces: { start: number; end: number }[], beats: number[]): number[] {
  const out: number[] = [];
  let offset = 0;
  pieces.forEach((p, i) => {
    const last = i === pieces.length - 1;
    for (const x of beats) if (x >= p.start - 1e-6 && (last ? x <= p.end + 1e-6 : x < p.end - 1e-6)) out.push(Math.round((offset + x - p.start) * 1000) / 1000);
    offset += p.end - p.start;
  });
  return out;
}
