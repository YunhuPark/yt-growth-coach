// Deciding what to cut for a "jump cut" edit: stretches of silence and hesitation sounds (음, 어...). Pure functions with no
// server imports, so the page can recompute the result instantly when the creator switches single cuts on or off.

export type Word = { start: number; end: number; text: string };
export type RemovalKind = "silence" | "filler";
export type Removal = { id: string; start: number; end: number; kind: RemovalKind; /** the word, for a filler */ text?: string };
export type Seg = { start: number; end: number };

export type CutOptions = {
  silence: {
    enabled: boolean;
    /** quieter than this counts as silence (dB; closer to 0 is stricter about what is quiet) */
    noiseDb: number;
    /** a quiet stretch has to last at least this long (seconds) to be cut */
    minSec: number;
    /** how much of each pause to keep, so speech does not run together (seconds, in total) */
    keepSec: number;
  };
  fillers: {
    enabled: boolean;
    /** also words like 그/저/뭐 when they are drawn out; off by default because they are real words too */
    loose: boolean;
  };
};

export const DEFAULT_CUT_OPTIONS: CutOptions = {
  silence: { enabled: true, noiseDb: -35, minSec: 0.6, keepSec: 0.2 },
  fillers: { enabled: false, loose: false },
};

const MIN_REMOVAL = 0.05;

/**
 * The part of each long-enough silence that goes, leaving `keepSec` of it (half at each end) so the speech around it still
 * breathes. A silence shorter than `minSec` is left alone.
 */
export function silenceRemovals(silences: Seg[], opts: { minSec: number; keepSec: number }): Removal[] {
  const half = Math.max(0, opts.keepSec) / 2;
  const out: Removal[] = [];
  for (const s of [...silences].sort((a, b) => a.start - b.start)) {
    if (!(s.end > s.start) || s.end - s.start < opts.minSec) continue;
    const start = s.start + half;
    const end = s.end - half;
    if (end - start >= MIN_REMOVAL) out.push({ id: `s${out.length}`, start, end, kind: "silence" });
  }
  return out;
}

const norm = (t: string) => t.replace(/[\s.,!?…~·"'“”‘’()\-]/g, "");

// Hesitation sounds on their own. "어" and "에" can be real one-word answers, so every cut is reviewed before it is applied.
const STRICT = /^(음+|으+음*|어+|에+|엄+|흠+|으+)$/;
// Words that are fillers when stretched out while the speaker thinks, but ordinary words otherwise.
const LOOSE = /^(그+|저+|뭐+|아+|이제|막)$/;
const LOOSE_MIN_SEC = 0.5;
const MAX_FILLER_SEC = 2.5; // a "word" longer than this is a recognition artefact, not a hesitation

/** Hesitation words among the recognised words, as cuts. A word's own time range is what is removed (with a hair of margin). */
export function fillerRemovals(words: Word[], opts: { loose: boolean }): Removal[] {
  const out: Removal[] = [];
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    const len = w.end - w.start;
    if (!(len > 0) || len > MAX_FILLER_SEC) continue;
    const t = norm(w.text);
    const hit = STRICT.test(t) || (opts.loose && LOOSE.test(t) && len >= LOOSE_MIN_SEC);
    if (!hit) continue;
    const start = w.start + 0.02;
    const end = w.end - 0.02;
    if (end - start >= MIN_REMOVAL) out.push({ id: `f${out.length}`, start, end, kind: "filler", text: w.text.trim() });
  }
  return out;
}

const overlap = (a: Seg, b: Seg) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/**
 * All cuts for the chosen options, in time order. A soft hesitation can register as a silence as well; when most of a silence is
 * a filler word the filler is kept and the silence row is dropped, so the same spot is not listed twice.
 */
export function planRemovals(silences: Seg[], words: Word[], opts: CutOptions): Removal[] {
  const fillers = opts.fillers.enabled ? fillerRemovals(words, opts.fillers) : [];
  const quiet = (opts.silence.enabled ? silenceRemovals(silences, opts.silence) : []).filter(
    (s) => !fillers.some((f) => overlap(s, f) > 0.5 * (s.end - s.start)),
  );
  return [...quiet, ...fillers].sort((a, b) => a.start - b.start).map((r, i) => ({ ...r, id: `${r.kind === "silence" ? "s" : "f"}${i}` }));
}

/**
 * What is left after the cuts: the complement of their union within [0, duration], with pieces shorter than `minKeep` dropped
 * (a sliver between two cuts would only flash by).
 */
export function keepSegments(duration: number, removals: Removal[], minKeep = 0.3): Seg[] {
  const cuts = removals
    .filter((r) => r.end > r.start)
    .map((r) => ({ start: Math.max(0, r.start), end: Math.min(duration, r.end) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const merged: Seg[] = [];
  for (const c of cuts) {
    const last = merged[merged.length - 1];
    if (last && c.start <= last.end) last.end = Math.max(last.end, c.end);
    else merged.push({ ...c });
  }
  const keep: Seg[] = [];
  let at = 0;
  for (const c of merged) {
    if (c.start - at >= minKeep) keep.push({ start: at, end: c.start });
    at = c.end;
  }
  if (duration - at >= minKeep) keep.push({ start: at, end: duration });
  return keep;
}

export type CutStats = { originalSec: number; keptSec: number; removedSec: number; pieces: number; silences: number; fillers: number };

export function cutStats(duration: number, kept: Seg[], removals: Removal[]): CutStats {
  const keptSec = kept.reduce((n, s) => n + s.end - s.start, 0);
  return {
    originalSec: duration,
    keptSec: Math.round(keptSec * 10) / 10,
    removedSec: Math.round((duration - keptSec) * 10) / 10,
    pieces: kept.length,
    silences: removals.filter((r) => r.kind === "silence").length,
    fillers: removals.filter((r) => r.kind === "filler").length,
  };
}

/** The renderer joins every piece with a filter of its own; past this many the graph gets too heavy, so the plan is warned about. */
export const MAX_PIECES = 400;
