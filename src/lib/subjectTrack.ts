import { promises as fs } from "node:fs";
import path from "node:path";
import { dedupeBoxes, type Look } from "./reframe";
import { subjectDetector, type Detector } from "./subjectDetector";
import { run } from "./render";

// Follows the subject through a video: look at a still every so often and note who or what is in it. Which of them to follow,
// and where the camera goes, is worked out from these notes by reframe.ts. Everything runs on this computer.

export type Seg = { start: number; end: number };

export type Track = {
  /** what each look found, in source time; turned into a camera target (for the chosen kind of subject) by samplesFromLooks */
  looks: Look[];
  /** a few stills, for showing where the crop would be: { t, jpeg data URL } */
  thumbs: { t: number; dataUrl: string }[];
};

export const FRAME_WIDTH = 320;
/** No more stills than this per run, so a long video is looked at less often instead of taking forever. */
export const MAX_FRAMES = 600;
export const MIN_STEP_SEC = 0.5;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Seconds between looks for this much video: every half second at most, fewer for long stretches. */
export const stepFor = (totalSec: number) => Math.max(MIN_STEP_SEC, totalSec / MAX_FRAMES);

/** Merges overlapping ranges and drops empty ones. */
export function mergeRanges(ranges: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const r of [...ranges].filter((x) => x.end > x.start).sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** The moments to look at: every `step` seconds inside each range, the middle of each interval. */
export function sampleTimes(ranges: Seg[], step: number): number[] {
  const out: number[] = [];
  for (const r of mergeRanges(ranges)) {
    for (let t = r.start + step / 2; t < r.end; t += step) out.push(Math.round(t * 100) / 100);
    if (r.end - r.start < step) out.push(Math.round(((r.start + r.end) / 2) * 100) / 100); // a range shorter than one step still gets a look
  }
  return out;
}

/**
 * Finds the person in each sampled still and returns where the camera should look, in source time. Ranges are the parts of the
 * source that will end up in the video (the whole thing when omitted). `detector` can be replaced for tests.
 */
export async function trackSubject(
  input: string,
  dir: string,
  opts: {
    duration: number;
    width: number;
    height: number;
    ranges?: Seg[];
    detector?: Detector;
    thumbs?: number;
    onStage?: (s: string) => void;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<Track> {
  await fs.mkdir(dir, { recursive: true });
  const ranges = mergeRanges(opts.ranges?.length ? opts.ranges : [{ start: 0, end: opts.duration }]).map((r) => ({
    start: Math.max(0, r.start),
    end: Math.min(opts.duration, r.end),
  }));
  const total = ranges.reduce((n, r) => n + r.end - r.start, 0);
  const step = stepFor(total);
  const frameH = Math.max(2, Math.round((FRAME_WIDTH * opts.height) / opts.width / 2) * 2);

  // One picture per look. For each range ffmpeg seeks there and writes a still every `step` seconds, small and fast to read.
  opts.onStage?.("화면 뽑는 중");
  const files: { t: number; file: string }[] = [];
  let n = 0;
  for (const r of ranges) {
    const first = sampleTimes([r], step);
    if (!first.length) continue;
    const prefix = `f${n}_`;
    const { code, stderr } = await run(
      [
        "-y", "-hide_banner", "-loglevel", "error",
        // the first still is the picture at first[0]; fps then emits one every `step` seconds after it
        "-ss", first[0].toFixed(2), "-i", input, "-t", Math.max(0.1, r.end - first[0]).toFixed(2),
        "-vf", `fps=1/${step.toFixed(3)},scale=${FRAME_WIDTH}:${frameH}`, "-q:v", "4", `${prefix}%05d.jpg`,
      ],
      dir,
      Math.max(5 * 60_000, (r.end - r.start) * 2000),
    );
    if (code !== 0) throw new Error(`화면을 뽑지 못했습니다: ${stderr.trim().split("\n").slice(-2).join(" ").slice(0, 200)}`);
    first.forEach((t, i) => files.push({ t, file: path.join(dir, `${prefix}${String(i + 1).padStart(5, "0")}.jpg`) }));
    n++;
  }

  const detect = opts.detector ?? subjectDetector({ width: FRAME_WIDTH, height: frameH }, (p) => opts.onStage?.(`대상 인식 모델 내려받는 중 (처음 한 번, 약 9MB) ${Math.round(p)}%`));
  const looks: Look[] = [];
  const seen: { t: number; file: string }[] = [];
  for (const [i, f] of files.entries()) {
    opts.onStage?.(`사람 찾는 중 ${i + 1}/${files.length}`);
    opts.onProgress?.(i, files.length);
    try {
      await fs.access(f.file);
    } catch {
      continue; // ffmpeg wrote fewer stills than expected near the end of a range
    }
    const boxes = dedupeBoxes(await detect(f.file)).map((b) => ({ ...b, x0: r3(b.x0), y0: r3(b.y0), x1: r3(b.x1), y1: r3(b.y1), score: r3(b.score) }));
    looks.push({ t: f.t, boxes });
    seen.push(f);
  }
  opts.onProgress?.(files.length, files.length);

  // A handful of the stills, to show the creator where the crop would sit.
  const want = Math.min(opts.thumbs ?? 0, seen.length);
  const thumbs: Track["thumbs"] = [];
  for (let i = 0; i < want; i++) {
    const f = seen[Math.floor(((i + 0.5) * seen.length) / want)];
    thumbs.push({ t: f.t, dataUrl: `data:image/jpeg;base64,${(await fs.readFile(f.file)).toString("base64")}` });
  }
  // The stills were only scratch work.
  await Promise.all(files.map((f) => fs.rm(f.file, { force: true })));
  return { looks, thumbs };
}
