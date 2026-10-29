// Reading an audience-retention curve (YouTube Studio -> a video -> Analytics -> Engagement -> audience retention -> download): where
// viewers leave, how bad the first seconds are, how fast they drain away in the middle, and where they came back to watch again.
// Pure functions with no server imports: the page runs them on what the creator pastes, so nothing leaves the computer.
//
// The split into three different problems (the opening, single steep drops, the steady slide) follows the framing of the MIT-licensed
// youtube-agent-skill's retention reader; the code and the thresholds here are written from scratch.

export type Point = { x: number; y: number };

export type Curve = {
  /** what the first column measures */
  unit: "percent" | "seconds";
  /** retention (percent of viewers still watching) against position, sorted by position */
  points: Point[];
};

export type ParseResult = { ok: true; curve: Curve; skipped: number } | { ok: false; error: string };

const MIN_POINTS = 8;
const MAX_POINTS = 5000;

/** "98.5%", "1,234", "1:02", "1:02:03", "0,5" (decimal comma, when asked) to a number; null when it is not one. */
export function parseNumber(cell: string, decimalComma = false): number | null {
  let c = cell.trim().replace(/%/g, "").replace(/\s/g, "");
  if (!c) return null;
  const clock = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(c);
  if (clock) return clock[3] !== undefined ? Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) : Number(clock[1]) * 60 + Number(clock[2]);
  c = decimalComma ? c.replace(/\./g, "").replace(",", ".") : c.replace(/,/g, "");
  if (!/^-?\d*\.?\d+(e-?\d+)?$/i.test(c)) return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

/**
 * Takes what was pasted from the export (comma, tab or semicolon separated, with or without header rows) and returns the curve. Each
 * data row is its first two numbers: the position and the share still watching. The position is guessed to be a percent of the
 * video (up to 100), a ratio (up to 1) or seconds (clock times, or past 100); a short video exported by seconds cannot be told from
 * percent, which is what `unitHint` is for. A retention that starts at about 1 is a ratio and becomes a percent.
 */
export function parseRetention(text: string, unitHint: "auto" | "percent" | "seconds" = "auto"): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { ok: false, error: "붙여 넣은 내용이 없습니다." };
  const sample = lines.slice(0, 12).join("\n");
  const delim = sample.includes("\t") ? "\t" : sample.includes(";") ? ";" : ",";
  const decimalComma = delim === ";";

  const rows: Point[] = [];
  let skipped = 0;
  let hasClock = false;
  for (const line of lines) {
    const nums = line
      .split(delim)
      .map((c) => {
        if (/^\s*\d+:\d{1,2}/.test(c)) hasClock = true;
        return parseNumber(c, decimalComma);
      })
      .filter((n): n is number => n !== null);
    if (nums.length >= 2) rows.push({ x: nums[0], y: nums[1] });
    else skipped++;
  }
  if (rows.length < MIN_POINTS) return { ok: false, error: `숫자 두 칸(위치, 시청 지속률)으로 된 줄이 ${MIN_POINTS}개 이상 필요합니다. 지금은 ${rows.length}개를 읽었습니다.` };
  if (rows.length > MAX_POINTS) return { ok: false, error: `점이 너무 많습니다(${rows.length}개, 최대 ${MAX_POINTS}개).` };

  // sort by position, and keep one value for a repeated position
  rows.sort((a, b) => a.x - b.x);
  const points = rows.filter((p, i) => i === 0 || p.x !== rows[i - 1].x);
  if (points.length < MIN_POINTS) return { ok: false, error: "위치가 서로 다른 점이 너무 적습니다." };
  if (points.some((p) => p.y < 0)) return { ok: false, error: "시청 지속률에 음수가 있습니다. 열 순서를 확인해 주세요(위치, 지속률 순서)." };

  const maxX = points[points.length - 1].x;
  const ratio = unitHint !== "seconds" && !hasClock && maxX <= 1.0001; // a share of the video, 0-1
  const unit: Curve["unit"] = unitHint === "seconds" || hasClock ? "seconds" : unitHint === "percent" || ratio || maxX <= 100.5 ? "percent" : "seconds";
  let out = ratio ? points.map((p) => ({ x: p.x * 100, y: p.y })) : points;
  const start = out[0].y;
  if (start > 0.5 && start <= 2) out = out.map((p) => ({ x: p.x, y: p.y * 100 })); // retention as a ratio that starts near 1
  return { ok: true, curve: { unit, points: out }, skipped };
}

// ---------------------------------------------------------------- the reading

export type Span = {
  /** position as a share of the video, 0-100 */
  fromPct: number;
  toPct: number;
  /** seconds, when the length of the video is known */
  fromSec: number | null;
  toSec: number | null;
  /** percentage points lost (cliff) or won back (rewatch) across the span */
  points: number;
};

export type Verdict = "healthy" | "leaking" | "severe";

export type Reading = {
  durationSec: number | null;
  start: number;
  end: number;
  /** length of the opening that was looked at */
  hookWindow: { pct: number; sec: number | null };
  hookLeak: number;
  hookVerdict: Verdict;
  cliffs: Span[];
  rewatches: Span[];
  /** typical loss per step in the middle, as percentage points per 10% of the video, and per minute when the length is known */
  slidePer10Pct: number;
  slidePerMin: number | null;
  /** the one thing to look at first, in plain words */
  main: { kind: "hook" | "cliff" | "slide" | "packaging"; title: string; advice: string };
};

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Linear interpolation of retention at a position (same unit as the points), held at the ends. */
export function valueAt(points: Point[], x: number): number {
  if (x <= points[0].x) return points[0].y;
  const last = points[points.length - 1];
  if (x >= last.x) return last.y;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x <= x) lo = mid;
    else hi = mid;
  }
  return points[lo].y + ((points[hi].y - points[lo].y) * (x - points[lo].x)) / (points[hi].x - points[lo].x);
}

/** The curve on an even grid of positions 0-100 %, so that steps are comparable whatever the export's spacing. */
function resample(curve: Curve, steps: number): { pct: number[]; y: number[] } {
  const span = curve.points[curve.points.length - 1].x - curve.points[0].x || 1;
  const x0 = curve.points[0].x;
  const pct: number[] = [];
  const y: number[] = [];
  for (let i = 0; i <= steps; i++) {
    pct.push((i / steps) * 100);
    y.push(valueAt(curve.points, x0 + (span * i) / steps));
  }
  return { pct, y };
}

/** Where steps stand out: a run of adjacent steps that each go past `threshold`, merged into one span, biggest first. */
function runs(pct: number[], delta: number[], threshold: number, sign: 1 | -1): { from: number; to: number; sum: number }[] {
  const out: { from: number; to: number; sum: number }[] = [];
  let cur: { from: number; to: number; sum: number } | null = null;
  for (let i = 1; i < pct.length; i++) {
    const d = sign * delta[i]; // delta[i] = y[i] - y[i-1]; for drops sign = -1 gives a positive amount
    if (d >= threshold) {
      if (cur) {
        cur.to = pct[i];
        cur.sum += d;
      } else cur = { from: pct[i - 1], to: pct[i], sum: d };
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out.sort((a, b) => b.sum - a.sum);
}

const HOOK_LEAKING = 25; // percentage points lost in the opening: rule of thumb, see the page's note
const HOOK_SEVERE = 40;

/**
 * Reads a curve. `durationSec` is needed to talk in seconds when the export is by percent of the video; with an export by seconds
 * it is taken from the last point unless given.
 */
export function readRetention(curve: Curve, durationSec?: number | null): Reading {
  const pts = curve.points;
  const duration = durationSec && durationSec > 0 ? durationSec : curve.unit === "seconds" ? pts[pts.length - 1].x - pts[0].x : null;
  const secAt = (pct: number) => (duration === null ? null : Math.round(((pct / 100) * duration) * 10) / 10);

  const start = pts[0].y;
  const end = pts[pts.length - 1].y;
  const steps = Math.min(200, Math.max(50, pts.length - 1));
  const { pct, y } = resample(curve, steps);
  const delta = y.map((v, i) => (i === 0 ? 0 : v - y[i - 1]));

  // the opening: the first 30 seconds, but never more than a fifth of a short video (10 % when the length is unknown)
  const hookPct = duration !== null ? Math.min((30 / duration) * 100, 20) : 10;
  const hookLeak = Math.max(0, start - valueAt(pts, pts[0].x + ((pts[pts.length - 1].x - pts[0].x) * hookPct) / 100));
  const hookVerdict: Verdict = hookLeak < HOOK_LEAKING ? "healthy" : hookLeak < HOOK_SEVERE ? "leaking" : "severe";

  // typical step in the middle; a "cliff" is a run of steps well above it
  const middle = delta.filter((_, i) => i > 0 && pct[i] > hookPct);
  const losses = middle.map((d) => Math.max(0, -d));
  const typical = median(losses);
  const mad = median(losses.map((l) => Math.abs(l - typical)));
  const stepPct = 100 / steps;
  const minDrop = 0.7 * (stepPct / 1); // at least 0.7 points per 1 % of the video
  const dropThreshold = Math.max(minDrop, typical + 3 * Math.max(mad, 0.05));
  const toSpan = (r: { from: number; to: number; sum: number }): Span => ({ fromPct: round1(r.from), toPct: round1(r.to), fromSec: secAt(r.from), toSec: secAt(r.to), points: round1(r.sum) });
  // the opening is reported as the hook leak, so a drop inside it is not listed a second time as a cliff
  const afterHook = delta.map((d, i) => (pct[i] <= hookPct ? 0 : d));
  const cliffs = runs(pct, afterHook, dropThreshold, -1).filter((r) => r.sum >= 1.5).slice(0, 5).map(toSpan);

  const riseThreshold = Math.max(0.3 * stepPct, 0.3);
  const rewatches = runs(pct, delta, riseThreshold, 1).filter((r) => r.sum >= 1).slice(0, 3).map(toSpan);

  const slidePer10Pct = round2(typical * (10 / stepPct));
  const slidePerMin = duration !== null && duration > 0 ? round2(typical * ((60 / duration) * (100 / stepPct)) ) : null;

  const base = { durationSec: duration, start: round1(start), end: round1(end), hookWindow: { pct: round1(hookPct), sec: secAt(hookPct) }, hookLeak: round1(hookLeak), hookVerdict, cliffs, rewatches, slidePer10Pct, slidePerMin };
  return { ...base, main: mainFinding(base) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
/** "1:05" when the length is known, "40% 지점" otherwise. */
export const placeOf = (s: Span) => (s.fromSec !== null ? `${clock(s.fromSec)}부터` : `영상의 ${Math.round(s.fromPct)}% 지점부터`);

/** What to look at first: the opening if it leaks, else the worst cliff, else a heavy slide, else not the video itself. */
function mainFinding(r: Omit<Reading, "main">): Reading["main"] {
  if (r.hookVerdict !== "healthy") {
    return {
      kind: "hook",
      title: `처음 ${r.hookWindow.sec !== null ? Math.round(r.hookWindow.sec) + "초" : "구간"}에 시청자의 ${r.hookLeak}%가 빠져나갑니다`,
      advice: "가장 먼저 첫 문장과 첫 장면을 손보세요. 중간 편집보다 도입이 먼저입니다. 결론이나 가장 흥미로운 장면을 앞으로 당기거나, 인사·설명을 줄여 보세요.",
    };
  }
  const worst = r.cliffs[0];
  if (worst && worst.points >= 5) {
    return {
      kind: "cliff",
      title: `${placeOf(worst)} ${worst.points}%p가 한꺼번에 빠집니다`,
      advice: "그 장면 바로 앞뒤를 다시 보세요. 화제가 갑자기 바뀌거나, 광고·긴 설명이 나오거나, 같은 말이 반복되는 곳일 가능성이 큽니다. 줄이거나 앞에 예고를 넣어 보세요.",
    };
  }
  if (r.slidePer10Pct >= 6) {
    return {
      kind: "slide",
      title: `중간에 영상 10%마다 약 ${r.slidePer10Pct}%p씩 꾸준히 빠집니다`,
      advice: "특정 순간이 아니라 전체 템포의 문제입니다. 다시 쓰기보다 중간을 잘라 내 속도를 올리는 쪽이 낫습니다(무음·군말 자르기가 도움이 됩니다).",
    };
  }
  return {
    kind: "packaging",
    title: "곡선 모양은 크게 나쁘지 않습니다",
    advice: "도입 이탈이 크지 않고 뚜렷한 급락도 없습니다. 조회수가 낮다면 영상 속보다 제목·썸네일(노출과 클릭) 쪽을 먼저 확인해 보세요.",
  };
}

// ---------------------------------------------------------------- what was said there

export type Cue = { start: number; end: number; text: string };

/** Reads SRT (or WebVTT) text into cues; lines that are not a time range with text are skipped. */
export function parseCues(text: string): Cue[] {
  const out: Cue[] = [];
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  const time = (s: string) => {
    const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(s);
    return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000 : null;
  };
  for (const b of blocks) {
    const lines = b.split("\n").filter((l) => l.trim());
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const [a, z] = lines[at].split("-->");
    const start = time(a);
    const end = time(z);
    const body = lines.slice(at + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    if (start !== null && end !== null && body) out.push({ start, end, text: body });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** What was being said within a few seconds of a span, for telling the creator what the drop was about. */
export function saidAt(cues: Cue[], fromSec: number, toSec: number, slack = 4, max = 140): string {
  const near = cues.filter((c) => c.start <= toSec + slack && c.end >= fromSec - slack).map((c) => c.text);
  const joined = near.join(" ");
  return joined.length > max ? `${joined.slice(0, max)}…` : joined;
}
