// Transitions and sound effects put at the cuts of a video. Pure: it only decides where and writes the ffmpeg filter text, so the
// page and the tests can use it without ffmpeg. The sounds are synthesized by ffmpeg itself (noise, sine waves), so there are no
// sound files to license or download.

export type TransitionKind = "none" | "flash" | "dip" | "punch";
export type CutSound = "none" | "whoosh" | "pop" | "tick";
export type SoundKind = "whoosh" | "pop" | "tick" | "ding";

export type EffectsOpts = {
  /** what the picture does at a cut: nothing, a white flash, a dip to black, or a quick zoom */
  transition: TransitionKind;
  /** the sound at a cut */
  cutSound: CutSound;
  /** a "pop" when the hook text appears */
  hookSound: boolean;
  /** a "ding" when the ending card appears */
  endingSound: boolean;
  /** how loud the effects are against the voice, 0.1 to 1 */
  volume: number;
  /** also decorate jump cuts that only took out a short pause; by default only cuts that skipped a real stretch are decorated */
  allCuts: boolean;
  /** times in the result at which to put the transition and sound, instead of at the cuts (the beats of the music, see beats.ts) */
  beatTimes: number[];
};

export const DEFAULT_EFFECTS: EffectsOpts = { transition: "none", cutSound: "none", hookSound: false, endingSound: false, volume: 0.5, allCuts: false, beatTimes: [] };

export const TRANSITIONS: { id: TransitionKind; label: string }[] = [
  { id: "none", label: "없음" },
  { id: "flash", label: "하얀 번쩍임" },
  { id: "dip", label: "잠깐 어두워짐" },
  { id: "punch", label: "살짝 확대 (줌 펀치)" },
];
export const CUT_SOUNDS: { id: CutSound; label: string }[] = [
  { id: "none", label: "없음" },
  { id: "whoosh", label: "휙 (whoosh)" },
  { id: "pop", label: "톡 (pop)" },
  { id: "tick", label: "딱 (tick)" },
];

/** A cut is decorated only when at least this much of the source was skipped there (a scene change, not a trimmed pause). */
export const MIN_SKIP_SEC = 1;
/** Decorated cuts are at least this far apart, so a fast edit does not turn into a strobe. */
export const MIN_GAP_SEC = 1.5;
/** Never more than this many: the filter text grows with them. */
export const MAX_DECORATED = 40;
/** On beats the effects come faster than on cuts, so they may be closer together and more numerous (but flashes are capped lower). */
export const MIN_BEAT_GAP_SEC = 0.18;
export const MAX_BEATS = 400;
const MAX_BEAT_PICTURE: Record<TransitionKind, number> = { none: 0, flash: 150, dip: 150, punch: 100 };

const TRANSITION_IDS = new Set<string>(TRANSITIONS.map((t) => t.id));
const SOUND_IDS = new Set<string>(CUT_SOUNDS.map((t) => t.id));

/** Fills gaps and clamps what came from outside (the page, a request). */
export function normalizeEffects(x?: Partial<EffectsOpts> | null): EffectsOpts {
  const d = DEFAULT_EFFECTS;
  const volume = Number(x?.volume);
  return {
    transition: x?.transition && TRANSITION_IDS.has(x.transition) ? x.transition : d.transition,
    cutSound: x?.cutSound && SOUND_IDS.has(x.cutSound) ? x.cutSound : d.cutSound,
    hookSound: x?.hookSound === true,
    endingSound: x?.endingSound === true,
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0.1, volume)) : d.volume,
    allCuts: x?.allCuts === true,
    beatTimes: sanitizeBeatTimes(x?.beatTimes),
  };
}

/** Finite, non-negative, sorted, rounded to a millisecond, without near-duplicates, at most MAX_BEATS. */
export function sanitizeBeatTimes(x: unknown): number[] {
  if (!Array.isArray(x)) return [];
  const t = x.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0).map((v) => Math.round(v * 1000) / 1000).sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of t) {
    if (out.length && v - out[out.length - 1] < MIN_BEAT_GAP_SEC) continue;
    if (out.length >= MAX_BEATS) break;
    out.push(v);
  }
  return out;
}

export const hasEffects = (o: EffectsOpts) => o.transition !== "none" || o.cutSound !== "none" || o.hookSound || o.endingSound;

/** The beats to decorate: inside the video (not at its very start or end), and not more than the picture effect can bear. */
export function pickBeats(beats: number[], outSec: number, o: EffectsOpts): number[] {
  const inside = beats.filter((b) => b >= 0.1 && b <= outSec - 0.1);
  const cap = o.transition === "none" ? MAX_BEATS : MAX_BEAT_PICTURE[o.transition];
  return inside.slice(0, cap);
}

/** Where the pieces of a joined video meet: the time in the result, and how much of the source was skipped just before it. */
export type CutPoint = { t: number; skippedSec: number };

export function cutPoints(pieces: { start: number; end: number }[]): CutPoint[] {
  const out: CutPoint[] = [];
  let t = 0;
  for (let i = 0; i < pieces.length; i++) {
    if (i > 0) out.push({ t: Math.round(t * 1000) / 1000, skippedSec: Math.max(0, Math.round((pieces[i].start - pieces[i - 1].end) * 1000) / 1000) });
    t += pieces[i].end - pieces[i].start;
  }
  return out;
}

/** The cuts to decorate: big enough, spread out, not at the very start or end of the video, and few. */
export function pickCuts(points: CutPoint[], outSec: number, o: EffectsOpts): number[] {
  const minSkip = o.allCuts ? 0 : MIN_SKIP_SEC;
  const picked: number[] = [];
  for (const p of points) {
    if (p.skippedSec < minSkip || p.t < 0.3 || p.t > outSec - 0.3) continue;
    if (picked.length && p.t - picked[picked.length - 1] < MIN_GAP_SEC) continue;
    if (picked.length >= MAX_DECORATED) break;
    picked.push(Math.round(p.t * 1000) / 1000);
  }
  return picked;
}

const n3 = (x: number) => (Math.round(x * 1000) / 1000).toString();

/**
 * Filters for the picture, in the result's time, to put before the text overlays so captions are not flashed or zoomed.
 * `size` is the frame size, which the zoom puts back after enlarging.
 */
export function transitionFilters(kind: TransitionKind, cuts: number[], size: { w: number; h: number }): string[] {
  if (kind === "none" || !cuts.length) return [];
  if (kind === "punch") {
    // One scale whose factor is the sum of a decaying pulse per cut (a quick 7% push in that eases out over 0.3 s), then the
    // frame is cut back to its size from the middle.
    const pulse = cuts.map((c) => `gte(t,${n3(c)})*max(0,1-(t-${n3(c)})/0.3)`).join("+");
    const z = `(1+0.07*(${pulse}))`;
    return [`scale=w='trunc(iw*${z}/2)*2':h='trunc(ih*${z}/2)*2':eval=frame`, `crop=${size.w}:${size.h}`];
  }
  // A triangle pulse of brightness around each cut: up for a flash, down to black for a dip.
  const peak = kind === "flash" ? 0.65 : -1;
  const half = kind === "flash" ? 0.12 : 0.1;
  return cuts.map((c) => `eq=brightness='${peak}*max(0,1-abs(t-${n3(c)})/${half})':eval=frame:enable='between(t,${n3(c - half)},${n3(c + half)})'`);
}

// The sounds. Each is a lavfi source that ends by itself; `lead` is how long before the event it starts so that its loudest part
// lands on the event (a whoosh swells into the cut).
export const SOUNDS: Record<SoundKind, { src: string; lead: number }> = {
  whoosh: { src: "anoisesrc=d=0.5:c=white:r=44100:a=0.7,highpass=f=500,lowpass=f=6500,afade=t=in:st=0:d=0.2,afade=t=out:st=0.2:d=0.3", lead: 0.2 },
  pop: { src: "aevalsrc='sin(2*PI*(420+900*exp(-t*50))*t)*exp(-t*28)':d=0.2:s=44100", lead: 0 },
  tick: { src: "aevalsrc='sin(2*PI*1900*t)*exp(-t*140)':d=0.06:s=44100", lead: 0 },
  ding: { src: "aevalsrc='(sin(2*PI*880*t)+0.5*sin(2*PI*1320*t))*exp(-t*5)*0.7':d=1:s=44100", lead: 0 },
};

export type SoundEvent = { kind: SoundKind; at: number };

export type EffectsPlan = {
  /** cuts that got a transition and/or a sound */
  cuts: number[];
  videoFilters: string[];
  sounds: SoundEvent[];
};

/** Decides what goes where, from the joined pieces (none for a video that was not cut) and the hook and ending cards. */
export function planEffects(
  input: { pieces: { start: number; end: number }[] | null; outSec: number; hook: boolean; endingFrom: number | null },
  o: EffectsOpts,
  size: { w: number; h: number },
): EffectsPlan {
  const cuts =
    o.transition === "none" && o.cutSound === "none"
      ? []
      : o.beatTimes.length
        ? pickBeats(o.beatTimes, input.outSec, o)
        : pickCuts(input.pieces ? cutPoints(input.pieces) : [], input.outSec, o);
  const sounds: SoundEvent[] = [];
  if (o.cutSound !== "none") for (const c of cuts) sounds.push({ kind: o.cutSound, at: c });
  if (o.hookSound && input.hook) sounds.push({ kind: "pop", at: 0 });
  if (o.endingSound && input.endingFrom !== null && input.endingFrom < input.outSec) sounds.push({ kind: "ding", at: Math.max(0, input.endingFrom) });
  sounds.sort((a, b) => a.at - b.at);
  return { cuts, videoFilters: transitionFilters(o.transition, cuts, size), sounds };
}

/**
 * The audio graph that lays the sounds over a base track: `base` and `out` are pad labels without brackets. Returns "" when there
 * is nothing to add. Each kind is made once and split into as many copies as it is used, each delayed to its moment.
 */
export function soundGraph(sounds: SoundEvent[], volume: number, base: string, out: string): string {
  if (!sounds.length) return "";
  const parts: string[] = [];
  const mixIn: string[] = [`[${base}]`];
  const kinds = [...new Set(sounds.map((s) => s.kind))];
  kinds.forEach((kind, ki) => {
    const mine = sounds.filter((s) => s.kind === kind);
    const fmt = `volume=${n3(volume)},aformat=sample_fmts=fltp:sample_rates=44100`;
    const labels = mine.map((_, i) => `[e${ki}_${i}]`);
    parts.push(`${SOUNDS[kind].src},${fmt}${mine.length > 1 ? `,asplit=${mine.length}${labels.join("")}` : labels[0]}`);
    mine.forEach((s, i) => {
      const ms = Math.max(0, Math.round((s.at - SOUNDS[kind].lead) * 1000));
      parts.push(`[e${ki}_${i}]adelay=${ms}|${ms}[d${ki}_${i}]`);
      mixIn.push(`[d${ki}_${i}]`);
    });
  });
  parts.push(`${mixIn.join("")}amix=inputs=${mixIn.length}:normalize=0:duration=first:dropout_transition=0,alimiter=limit=0.95[${out}]`);
  return parts.join(";");
}
