import { promises as fs } from "node:fs";
import path from "node:path";
import { probe, run, type Probe } from "./render";

// Turns a video file into numbers and a few still frames that a model can reason about:
// where the picture changes, where it goes quiet, how loud each second is.

export type Silence = { start: number; end: number };
export type Loudness = { t: number; db: number };
export type Frame = { t: number; file: string };

export type Analysis = Probe & {
  scenes: number[];
  silences: Silence[];
  loudness: Loudness[];
  frames: Frame[];
};

const SCENE_THRESHOLD = 0.3;
const SILENCE_DB = -35;
const SILENCE_MIN_SEC = 0.7;
const MAX_FRAMES = 16;

/** Times (seconds) of the frames ffmpeg's `showinfo` printed after the scene-change `select`. */
export function parseSceneTimes(log: string): number[] {
  const out: number[] = [];
  for (const m of log.matchAll(/\[Parsed_showinfo[^\]]*\][^\n\r]*?pts_time:\s*(\d+(?:\.\d+)?)/g)) out.push(Number(m[1]));
  return out;
}

/** `silencedetect` pairs. A silence still open when the file ends is closed at `duration`. */
export function parseSilences(log: string, duration: number): Silence[] {
  const out: Silence[] = [];
  let open: number | null = null;
  for (const m of log.matchAll(/silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g)) {
    const t = Number(m[2]);
    if (m[1] === "start") open = Math.max(0, t);
    else if (open !== null) {
      out.push({ start: open, end: Math.min(duration, t) });
      open = null;
    }
  }
  if (open !== null && duration > open) out.push({ start: open, end: duration });
  return out.filter((s) => s.end > s.start);
}

/** Per-second RMS level from `astats` + `ametadata=print`. Digital silence prints "-inf"; it is floored at -90 dB. */
export function parseLoudness(log: string): Loudness[] {
  const out: Loudness[] = [];
  let t: number | null = null;
  for (const m of log.matchAll(/pts_time:\s*(\d+(?:\.\d+)?)|Overall\.RMS_level=\s*(-?inf|-?\d+(?:\.\d+)?)/g)) {
    if (m[1] !== undefined) t = Number(m[1]);
    else if (t !== null) {
      const v = Number(m[2]);
      out.push({ t, db: Number.isFinite(v) ? Math.max(-90, v) : -90 });
      t = null;
    }
  }
  return out;
}

/** Which moments to look at: evenly spaced, plus the first frame after each scene change, capped and de-duplicated. */
export function pickFrameTimes(duration: number, scenes: number[], max = MAX_FRAMES): number[] {
  if (duration <= 0 || max <= 0) return [];
  const minGap = Math.max(0.5, duration / (max * 2));
  const count = Math.min(max, Math.max(1, Math.floor(duration / 3)));
  const even = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * duration);
  const all = [...even, ...scenes.map((s) => Math.min(duration - 0.1, s + 0.2))].filter((t) => t >= 0).sort((a, b) => a - b);
  const kept: number[] = [];
  for (const t of all) if (!kept.length || t - kept[kept.length - 1] >= minGap) kept.push(t);
  // Too many: thin out evenly instead of cutting off the end of the video.
  if (kept.length <= max) return kept.map((t) => Math.round(t * 10) / 10);
  return Array.from({ length: max }, (_, i) => kept[Math.round((i * (kept.length - 1)) / (max - 1 || 1))]).map((t) => Math.round(t * 10) / 10);
}

/** One line per second, for the model: "12s -23dB". Long videos are summarised per `bucket` seconds (peak of the bucket). */
export function summarizeLoudness(l: Loudness[], bucket: number): { t: number; db: number }[] {
  if (bucket <= 1) return l.map((x) => ({ t: Math.round(x.t), db: Math.round(x.db) }));
  const out: { t: number; db: number }[] = [];
  for (let i = 0; i < l.length; i += bucket) {
    const part = l.slice(i, i + bucket);
    out.push({ t: Math.round(part[0].t), db: Math.round(Math.max(...part.map((p) => p.db))) });
  }
  return out;
}

/**
 * Looks at the whole file with ffmpeg. Scene changes and loudness are separate passes; a failure in one (for example a
 * file with no audio) just leaves that part empty. Frames are written to `dir` as f0.jpg, f1.jpg, ...
 */
export async function analyzeVideo(input: string, dir: string, onStage?: (stage: string) => void): Promise<Analysis> {
  await fs.mkdir(dir, { recursive: true });
  const info = await probe(input, dir);
  const long = Math.max(10 * 60_000, info.duration * 1500);

  onStage?.("장면 전환 찾는 중");
  let sceneLog = "";
  await run(
    ["-hide_banner", "-i", input, "-an", "-vf", `scale=320:-2,select='gt(scene,${SCENE_THRESHOLD})',showinfo`, "-f", "null", "-"],
    dir,
    long,
    undefined,
    (c) => (sceneLog += c),
  );
  const scenes = parseSceneTimes(sceneLog);

  let silences: Silence[] = [];
  let loudness: Loudness[] = [];
  if (info.hasAudio) {
    onStage?.("소리 분석 중");
    let audioLog = "";
    await run(
      [
        "-hide_banner", "-i", input, "-vn",
        "-af", `silencedetect=noise=${SILENCE_DB}dB:d=${SILENCE_MIN_SEC},asetnsamples=n=44100,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level`,
        "-f", "null", "-",
      ],
      dir,
      long,
      undefined,
      (c) => (audioLog += c),
    );
    silences = parseSilences(audioLog, info.duration);
    loudness = parseLoudness(audioLog);
  }

  onStage?.("대표 장면 뽑는 중");
  const frames: Frame[] = [];
  for (const [i, t] of pickFrameTimes(info.duration, scenes).entries()) {
    const file = `f${i}.jpg`;
    const { code } = await run(
      ["-y", "-hide_banner", "-loglevel", "error", "-ss", t.toFixed(2), "-i", input, "-frames:v", "1", "-vf", "scale='min(640,iw)':-2", "-q:v", "5", file],
      dir,
      60_000,
    );
    if (code === 0) frames.push({ t, file: path.join(dir, file) });
  }
  return { ...info, scenes, silences, loudness, frames };
}
