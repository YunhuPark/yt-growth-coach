import { promises as fs } from "node:fs";
import { assignTracks, cropFraction, cropHeightFraction, samplesFromLooks, smoothTrack, suggestZoom, trackStats, type Keyframe, type Target } from "./reframe";
import type { Detector } from "./subjectDetector";
import { probe, type RenderOpts } from "./render";
import { trackSubject, type Seg } from "./subjectTrack";

// Auto reframe inside a render: before the video is made, find who to follow in the parts that will be used and put the camera
// path into the render options.

/** The parts of the source a render will use: its pieces, or the trimmed span, or all of it. */
export function usedRanges(opts: Pick<RenderOpts, "segments" | "trimStart" | "trimEnd">, duration: number): Seg[] {
  if (opts.segments?.length) return opts.segments.map((s) => ({ start: s.start, end: s.end }));
  const start = Math.max(0, opts.trimStart ?? 0);
  const end = Math.min(duration, opts.trimEnd && opts.trimEnd > 0 ? opts.trimEnd : duration);
  return [{ start, end }];
}

export type AutoReframeResult = {
  opts: RenderOpts;
  /** share of the looks that found someone; null when no tracking was needed */
  foundPct: number | null;
  note?: string;
};

/**
 * Adds a camera path to the options of a vertical render of a wider video. Nothing changes for a render that is not vertical or
 * whose source is already as narrow as the frame (it reports that in `note`).
 */
export async function withAutoReframe(
  input: string,
  dir: string,
  opts: RenderOpts,
  args: { smooth?: number; target?: Target; /** 1 = none, a number up to 3, or "auto" to fit the subject */ zoom?: number | "auto"; detector?: Detector; onStage?: (s: string) => void },
): Promise<AutoReframeResult> {
  if ((opts.layout ?? "short") !== "short") return { opts, foundPct: null, note: "가로 영상으로 만들 때는 사람을 따라가는 자르기를 쓰지 않습니다." };
  await fs.mkdir(dir, { recursive: true });
  const info = await probe(input, dir);
  if (!info.width || !info.height) return { opts, foundPct: null, note: "영상 크기를 알 수 없어 사람을 따라가는 자르기를 건너뛰었습니다." };
  const cropFrac = cropFraction(info.width, info.height);
  if (cropFrac >= 0.98) return { opts, foundPct: null, note: "원본이 이미 세로 영상이라 따로 자를 필요가 없습니다." };

  const track = await trackSubject(input, dir, {
    duration: info.duration,
    width: info.width,
    height: info.height,
    ranges: usedRanges(opts, info.duration),
    detector: args.detector,
    onStage: args.onStage,
  });
  const target = args.target ?? "person";
  const zoom = args.zoom === "auto" ? suggestZoom(track.looks, target) : (args.zoom ?? 1);
  const samples = samplesFromLooks(assignTracks(track.looks), { target, cropFrac: cropFraction(info.width, info.height, zoom) });
  const stats = trackStats(samples);
  const keyframes: Keyframe[] = smoothTrack(samples, {
    cropFrac: cropFraction(info.width, info.height, zoom),
    cropHFrac: cropHeightFraction(zoom),
    duration: info.duration,
    smooth: args.smooth ?? 3,
    hz: 10,
  });
  const what = { person: "사람", animal: "동물", vehicle: "탈것", all: "대상" }[target];
  const note =
    stats.total === 0
      ? `${what}을(를) 찾을 화면이 없어 가운데로 자랐습니다.`
      : stats.pct < 40
        ? `${what}을(를) 찾은 화면이 ${stats.pct}%뿐이라 대부분 가운데 근처로 잘렸습니다. 작거나 가려진 영상일 수 있습니다.`
        : undefined;
  return { opts: { ...opts, reframe: { keyframes, zoom } }, foundPct: stats.pct, note };
}
