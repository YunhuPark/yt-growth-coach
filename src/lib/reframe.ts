// Auto reframe: turning a horizontal video into a vertical one whose crop follows the person. Pure functions with no server
// imports, so the page can redraw the camera path instantly when the smoothness changes.

/** A detection, as fractions of the picture (origin top-left). `label` is what the model called it; none means a person. */
export type Box = { x0: number; y0: number; x1: number; y1: number; score: number; label?: string };
/** What one look at one still found. */
export type Look = { t: number; boxes: Box[] };
/** A detection that is believed to be the same thing as the ones with the same id in other looks. */
export type TrackedBox = Box & { id: number };
export type TrackedLook = { t: number; boxes: TrackedBox[] };
/**
 * Where the subject was at time t (seconds in the source): the centre as fractions of the width (cx) and height (cy), or null if
 * nobody was found.
 */
export type Sample = { t: number; cx: number | null; cy?: number | null };
/** Where the crop window is centred at time t, as fractions of the picture; cy is absent for a path that only pans sideways. */
export type Keyframe = { t: number; cx: number; cy?: number };

// ---------------------------------------------------------------- what to follow

export type Target = "person" | "animal" | "vehicle" | "all";
export const TARGETS: { id: Target; label: string }[] = [
  { id: "person", label: "사람" },
  { id: "animal", label: "동물" },
  { id: "vehicle", label: "탈것(자동차·자전거·배 등)" },
  { id: "all", label: "사람·동물·탈것 모두" },
];
const ANIMALS = new Set(["bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe"]);
const VEHICLES = new Set(["bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat"]);
export const labelOf = (b: Box) => b.label ?? "person";
/** The classes of the detector worth keeping: everything that can be followed. */
export const isSubjectLabel = (label: string) => label === "person" || ANIMALS.has(label) || VEHICLES.has(label);
export function inTarget(b: Box, target: Target): boolean {
  const l = labelOf(b);
  if (target === "person") return l === "person";
  if (target === "animal") return ANIMALS.has(l);
  if (target === "vehicle") return VEHICLES.has(l);
  return isSubjectLabel(l);
}

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(z) ? z : 1));

/**
 * The share of the picture's width that a 9:16 window covers (1 = the picture is already that narrow). With `zoom` above 1 the
 * window is that much smaller, both ways, so the subject fills more of the result.
 */
export function cropFraction(srcW: number, srcH: number, zoom = 1): number {
  if (!(srcW > 0) || !(srcH > 0)) return 1;
  return Math.min(1, (srcH * 9) / 16 / clampZoom(zoom) / srcW);
}

/** The share of the picture's height that the window covers: 1 without zoom. */
export const cropHeightFraction = (zoom = 1) => 1 / clampZoom(zoom);

/** Even pixel size of the 9:16 window; crops and scalers prefer even numbers. */
export function cropSizePx(srcW: number, srcH: number, zoom = 1): { w: number; h: number } {
  const h = Math.min(srcH, Math.max(2, Math.round(srcH / clampZoom(zoom) / 2) * 2));
  const w = Math.min(srcW, Math.max(2, Math.round((h * 9) / 16 / 2) * 2));
  return { w, h };
}
export const cropWidthPx = (srcW: number, srcH: number, zoom = 1) => cropSizePx(srcW, srcH, zoom).w;

// ---------------------------------------------------------------- who to follow

const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const cxOf = (b: Box) => (b.x0 + b.x1) / 2;

function iou(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / (area(a) + area(b) - inter);
}

/** Drops weak detections and the duplicates the detector produces for one person (keeping the more confident of two that overlap). */
export function dedupeBoxes(boxes: Box[], opts: { minScore?: number; overlap?: number } = {}): Box[] {
  const { minScore = 0.5, overlap = 0.5 } = opts;
  const kept: Box[] = [];
  for (const b of [...boxes].filter((x) => x.score >= minScore && area(x) > 0).sort((p, q) => q.score - p.score)) {
    if (!kept.some((k) => labelOf(k) === labelOf(b) && iou(k, b) > overlap)) kept.push(b);
  }
  return kept;
}

/**
 * The point to centre the crop on. When everyone fits in the window, the middle of the group. When they don't, one person: the
 * most prominent (big and sure), nudged toward whoever was followed a moment ago so the camera doesn't hop between people.
 */
export function chooseTarget(boxes: Box[], prev: number | null, cropFrac: number): number | null {
  return chooseFocus(boxes, prev, cropFrac)?.cx ?? null;
}

export type Focus = { cx: number; cy: number };
/** A detection with less than this share of the biggest one's area, in the same look, is left out when choosing where to look. */
const MIN_RELATIVE_AREA = 0.1;

/** Like chooseTarget, and also where to look vertically: a person's upper body (head room), the middle of anything else. */
export function chooseFocus(boxes: Box[], prev: number | null, cropFrac: number): Focus | null {
  // Something far smaller than the main subject (a parked car behind a dog, a passer-by behind the speaker) is scenery: it must
  // not pull the middle of the group toward itself. A subject alone is followed however small it is.
  const all = dedupeBoxes(boxes);
  const biggest = Math.max(0, ...all.map(area));
  const found = all.filter((b) => area(b) >= biggest * MIN_RELATIVE_AREA);
  if (!found.length) return null;
  const focus = (set: Box[], cx: number): Focus => {
    const y0 = Math.min(...set.map((b) => b.y0));
    const y1 = Math.max(...set.map((b) => b.y1));
    return { cx, cy: y0 + (set.every((b) => labelOf(b) === "person") ? 0.3 : 0.5) * (y1 - y0) };
  };
  const x0 = Math.min(...found.map((b) => b.x0));
  const x1 = Math.max(...found.map((b) => b.x1));
  if (x1 - x0 <= cropFrac * 0.95) return focus(found, (x0 + x1) / 2);
  const rank = (b: Box) => b.score * area(b) * (prev === null ? 1 : Math.exp(-3 * Math.abs(cxOf(b) - prev)));
  const best = found.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  return focus([best], cxOf(best));
}

/**
 * Tells the same thing apart across looks: a detection takes the id of the one it overlaps or sits closest to in the looks of the
 * last couple of seconds, and starts a new id otherwise (a new person, or a cut in the video). Greedy, nearest first.
 */
export function assignTracks(looks: Look[]): TrackedLook[] {
  const MAX_GAP_SEC = 1.6;
  const live: { id: number; box: Box; t: number }[] = [];
  let next = 1;
  const out: TrackedLook[] = [];
  for (const look of [...looks].sort((a, b) => a.t - b.t)) {
    const dist = (a: Box, b: Box) => Math.hypot((a.x0 + a.x1 - b.x0 - b.x1) / 2, (a.y0 + a.y1 - b.y0 - b.y1) / 2);
    const pairs: { ti: number; bi: number; d: number }[] = [];
    live.forEach((tr, ti) => {
      if (look.t - tr.t > MAX_GAP_SEC) return;
      look.boxes.forEach((b, bi) => {
        if (labelOf(b) !== labelOf(tr.box)) return;
        const d = dist(tr.box, b);
        if (iou(tr.box, b) > 0.1 || d < 0.1) pairs.push({ ti, bi, d });
      });
    });
    pairs.sort((p, q) => p.d - q.d);
    const takenT = new Set<number>();
    const ids = new Map<number, number>();
    for (const p of pairs) {
      if (takenT.has(p.ti) || ids.has(p.bi)) continue;
      takenT.add(p.ti);
      ids.set(p.bi, live[p.ti].id);
    }
    const boxes: TrackedBox[] = look.boxes.map((b, bi) => ({ ...b, id: ids.get(bi) ?? next++ }));
    for (const b of boxes) {
      const tr = live.find((x) => x.id === b.id);
      if (tr) {
        tr.box = b;
        tr.t = look.t;
      } else live.push({ id: b.id, box: b, t: look.t });
    }
    out.push({ t: look.t, boxes });
  }
  return out;
}

/**
 * Where to look at each moment, for the chosen kind of subject. With `picks` (ids from assignTracks) only those are followed, and
 * a look where none of them is seen has no answer (the camera holds, then settles toward the middle) rather than hopping to
 * someone else. `cropFrac` is the window's width as a share of the picture's, after any zoom.
 */
export function samplesFromLooks(looks: TrackedLook[], o: { target: Target; cropFrac: number; picks?: number[] }): Sample[] {
  const picks = o.picks?.length ? new Set(o.picks) : null;
  let prev: number | null = null;
  return looks.map((look) => {
    const boxes = look.boxes.filter((b) => inTarget(b, o.target) && (!picks || picks.has(b.id)));
    const f = chooseFocus(boxes, prev, o.cropFrac);
    if (f) prev = f.cx;
    return { t: look.t, cx: f?.cx ?? null, cy: f?.cy ?? null };
  });
}

/**
 * How far to zoom so the subject fills about half the window's height: the median height of the most prominent subject over the
 * video. 1 (no zoom) when it is already big; never more than 2, because enlarging a small piece of a picture makes it soft.
 */
export function suggestZoom(looks: Look[], target: Target): number {
  const heights: number[] = [];
  for (const look of looks) {
    const hs = dedupeBoxes(look.boxes.filter((b) => inTarget(b, target))).map((b) => b.y1 - b.y0);
    if (hs.length) heights.push(Math.max(...hs));
  }
  if (!heights.length) return 1;
  heights.sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  return Math.round(Math.min(2, Math.max(1, 0.55 / Math.max(median, 0.05))) * 10) / 10;
}

// ---------------------------------------------------------------- the camera

export type PathOptions = {
  cropFrac: number;
  /** length of the span the path covers, seconds */
  duration: number;
  /** 1 (follows quickly) to 5 (slow and steady) */
  smooth: number;
  /** keyframes per second in the result */
  hz?: number;
  /** keep the camera at the middle of the frame instead of following anyone */
  fixed?: boolean;
};

export const SMOOTH_MIN = 1;
export const SMOOTH_MAX = 5;
// Fastest the camera may pan, as a share of the picture width per second, and how hard it pulls toward the subject.
const MAX_SPEED = [1.2, 0.8, 0.5, 0.3, 0.18];
const PULL = [8, 5, 3, 2, 1.2];
const HOLD_SEC = 1.5; // how long to keep looking where the subject was last seen before drifting back to the middle
const SNAP_JUMP = 0.3; // a move this big between two looks, if it then stays put, is a cut in the video: the camera jumps too

const median3 = (a: number, b: number, c: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

/** Fills the gaps where nobody was found: hold the last place a while, then settle toward the middle; leading gaps take the first find. */
function fillGaps(samples: Sample[]): number[] {
  const firstSeen = samples.find((s) => s.cx !== null)?.cx ?? 0.5;
  const out: number[] = [];
  let last = firstSeen;
  let lostSince: number | null = null;
  for (const s of samples) {
    if (s.cx !== null) {
      last = s.cx;
      lostSince = null;
    } else {
      lostSince ??= s.t;
      if (s.t - lostSince > HOLD_SEC) last += (0.5 - last) * 0.15; // a slow drift, not a jump
    }
    out.push(last);
  }
  return out;
}

/** The camera's centre over time at `hz` keyframes a second, as fractions of the picture width, never leaving the picture. */
export function smoothPath(samples: Sample[], opts: PathOptions): Keyframe[] {
  const hz = opts.hz ?? 10;
  const half = opts.cropFrac / 2;
  const lo = half;
  const hi = 1 - half;
  const clamp = (x: number) => Math.min(hi, Math.max(lo, x));
  const n = Math.max(1, Math.ceil(opts.duration * hz));

  if (opts.fixed || samples.length === 0 || opts.cropFrac >= 0.999) {
    return Array.from({ length: n + 1 }, (_, i) => ({ t: i / hz, cx: clamp(0.5) }));
  }

  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const raw = fillGaps(sorted);
  // one stray look must not drag the camera: the median of three, except where a move is a real cut
  const cx = raw.map((v, i) => (i === 0 || i === raw.length - 1 ? v : median3(raw[i - 1], v, raw[i + 1])));
  const snaps = new Set<number>();
  for (let i = 1; i < raw.length - 1; i++) {
    if (Math.abs(raw[i] - raw[i - 1]) > SNAP_JUMP && Math.abs(raw[i + 1] - raw[i]) < 0.15) {
      snaps.add(i);
      cx[i] = raw[i];
    }
  }

  const k = Math.min(SMOOTH_MAX, Math.max(SMOOTH_MIN, Math.round(opts.smooth))) - 1;
  const maxStep = MAX_SPEED[k] / hz;
  const pull = PULL[k];
  const dead = Math.max(0.01, opts.cropFrac * 0.12); // the subject may wander this far from the centre without the camera moving
  const times = sorted.map((s) => s.t);
  const at = (t: number) => {
    // linear interpolation of the (cleaned) subject position at time t
    let j = 0;
    while (j < times.length - 1 && times[j + 1] <= t) j++;
    if (j >= times.length - 1) return cx[cx.length - 1];
    const span = times[j + 1] - times[j] || 1;
    return cx[j] + ((cx[j + 1] - cx[j]) * (t - times[j])) / span;
  };

  const path: Keyframe[] = [];
  let cam = clamp(at(times[0] ?? 0));
  let snapIdx = 0;
  const snapList = [...snaps].sort((a, b) => a - b);
  for (let i = 0; i <= n; i++) {
    const t = i / hz;
    while (snapIdx < snapList.length && times[snapList[snapIdx]] <= t) {
      cam = clamp(cx[snapList[snapIdx]]); // a cut in the video: jump with it
      snapIdx++;
    }
    const target = clamp(at(t));
    const dev = target - cam;
    if (Math.abs(dev) > dead) {
      const want = target - Math.sign(dev) * dead;
      const step = Math.max(-maxStep, Math.min(maxStep, (want - cam) * pull * (1 / hz)));
      cam = clamp(cam + step);
    }
    path.push({ t, cx: Math.round(cam * 10000) / 10000 });
  }
  return path;
}

/**
 * The camera over time in both directions: sideways as smoothPath does, and up and down the same way when the window is shorter
 * than the picture (zoomed in). `cropFrac` and `cropHFrac` are the window's width and height as shares of the picture's.
 */
export function smoothTrack(samples: Sample[], opts: PathOptions & { cropHFrac: number }): Keyframe[] {
  const xs = smoothPath(samples, opts);
  const ys = smoothPath(
    samples.map((s) => ({ t: s.t, cx: s.cy ?? null })),
    { ...opts, cropFrac: opts.cropHFrac },
  );
  return xs.map((k, i) => ({ t: k.t, cx: k.cx, cy: ys[i].cx }));
}

/** Share of looks that found someone, for telling the creator how much of the path is a guess. */
export function trackStats(samples: Sample[]) {
  const found = samples.filter((s) => s.cx !== null).length;
  return { found, total: samples.length, pct: samples.length ? Math.round((found / samples.length) * 100) : 0 };
}

// ---------------------------------------------------------------- handing the path to ffmpeg

function lerpAt(keys: Keyframe[], t: number, pick: (k: Keyframe) => number): number {
  if (!keys.length) return 0.5;
  if (t <= keys[0].t) return pick(keys[0]);
  const last = keys[keys.length - 1];
  if (t >= last.t) return pick(last);
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const span = keys[hi].t - keys[lo].t || 1;
  return pick(keys[lo]) + ((pick(keys[hi]) - pick(keys[lo])) * (t - keys[lo].t)) / span;
}

/** Linear interpolation of the keyframes at time t (held at the ends). */
export const cxAt = (keys: Keyframe[], t: number): number => lerpAt(keys, t, (k) => k.cx);
/** Same for the vertical position; the middle when the path has none. */
export const cyAt = (keys: Keyframe[], t: number): number => lerpAt(keys, t, (k) => k.cy ?? 0.5);

/** Left edge in pixels (even) of a window of `cropW` centred at fraction `cx` of a picture `srcW` wide. */
export function cropX(cx: number, srcW: number, cropW: number): number {
  const x = Math.round((cx * srcW - cropW / 2) / 2) * 2;
  return Math.min(srcW - cropW, Math.max(0, x));
}

/**
 * The `sendcmd` script that moves the crop window: one command per output frame slot (`hz` a second), each taking the camera
 * position at the matching moment of the source. `toSource` maps a time in the result to a time in the source, which is how a
 * video that was cut into pieces still follows the right person in each piece.
 */
export function panScript(args: {
  keys: Keyframe[];
  srcW: number;
  cropW: number;
  /** with both, the window also moves up and down (a zoomed-in window shorter than the picture) */
  srcH?: number;
  cropH?: number;
  outSec: number;
  toSource: (t: number) => number;
  hz?: number;
  name?: string;
}): string {
  const hz = args.hz ?? 30;
  const name = args.name ?? "pan";
  const n = Math.ceil(args.outSec * hz);
  const vertical = args.srcH !== undefined && args.cropH !== undefined && args.cropH < args.srcH;
  const lines: string[] = [];
  let lastX = -1;
  let lastY = -1;
  for (let i = 0; i <= n; i++) {
    const t = i / hz;
    const src = args.toSource(t);
    const x = cropX(cxAt(args.keys, src), args.srcW, args.cropW);
    const y = vertical ? cropX(cyAt(args.keys, src), args.srcH!, args.cropH!) : 0;
    if (x === lastX && y === lastY) continue; // only when it moves
    const cmds = [];
    if (x !== lastX) cmds.push(`crop@${name} x ${x}`);
    if (vertical && y !== lastY) cmds.push(`crop@${name} y ${y}`);
    lines.push(`${t.toFixed(3)} ${cmds.join(", ")};`);
    lastX = x;
    lastY = y;
  }
  return lines.join("\n") + "\n";
}
