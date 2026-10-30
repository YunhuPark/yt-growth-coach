import { promises as fs } from "node:fs";
import path from "node:path";
import MusicTempo from "music-tempo";
import { bpmOf, regularity } from "./beats";
import { probe, run } from "./render";

// Finds the beats of the sound of a video, on this computer: ffmpeg writes the sound as plain numbers and the music-tempo package
// (MIT, the BeatRoot algorithm of Simon Dixon) finds the tempo and where the beats fall.

export const SAMPLE_RATE = 22050;
// music-tempo assumes 44.1 kHz sound (a hop of 441 samples is "0.01 s"); at a lower rate its window and time step are given instead.
const HOP = 220;
const TUNING = { bufferSize: 1024, hopSize: HOP, timeStep: HOP / SAMPLE_RATE };
/** At most this much sound is listened to in one go. */
export const MAX_ANALYSIS_SEC = 600;

export type BeatAnalysis = {
  /** length of the whole video */
  duration: number;
  width?: number;
  height?: number;
  /** the stretch that was listened to */
  fromSec: number;
  analyzedSec: number;
  bpm: number;
  /** beat times in seconds from the start of the video */
  beats: number[];
  /** how evenly spaced they are, 0 to 1 */
  regularity: number;
};

export class NoSoundError extends Error {}

/** Beats of `input` between `startSec` and `startSec + lengthSec` (the first 10 minutes at most). */
export async function analyzeBeats(input: string, dir: string, opts: { startSec?: number; lengthSec?: number } = {}): Promise<BeatAnalysis> {
  await fs.mkdir(dir, { recursive: true });
  const info = await probe(input, dir);
  if (!info.hasAudio) throw new NoSoundError("이 영상에는 소리가 없어 박자를 찾을 수 없습니다.");
  const fromSec = Math.min(Math.max(0, opts.startSec ?? 0), Math.max(0, info.duration - 1));
  const analyzedSec = Math.min(MAX_ANALYSIS_SEC, opts.lengthSec ?? MAX_ANALYSIS_SEC, info.duration - fromSec);
  if (analyzedSec < 4) throw new Error("박자를 찾기엔 소리가 너무 짧습니다(4초 이상 필요).");

  const raw = path.join(dir, "beats.f32");
  const { code, stderr } = await run(
    ["-y", "-hide_banner", "-loglevel", "error", "-ss", fromSec.toFixed(2), "-t", analyzedSec.toFixed(2), "-i", input, "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", raw],
    dir,
    5 * 60_000,
  );
  if (code !== 0) throw new Error(`소리를 읽지 못했습니다: ${stderr.trim().split("\n").slice(-2).join(" ").slice(0, 200)}`);
  const bytes = await fs.readFile(raw);
  await fs.rm(raw, { force: true });
  const samples = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 4));

  const found = findBeats(samples);
  const beats = found.beats.map((b) => Math.round((b + fromSec) * 1000) / 1000);
  return { duration: info.duration, width: info.width, height: info.height, fromSec, analyzedSec, bpm: bpmOf(beats), beats, regularity: regularity(beats) };
}

/** The beat times (seconds from the start of the samples) of mono sound at SAMPLE_RATE. Empty when no beat is found. */
export function findBeats(samples: Float32Array): { beats: number[] } {
  try {
    const mt = new MusicTempo(samples as unknown as ArrayLike<number>, { ...TUNING });
    return { beats: Array.isArray(mt.beats) ? mt.beats.filter((b) => Number.isFinite(b)) : [] };
  } catch {
    return { beats: [] }; // too little or too even a sound for the algorithm to say anything
  }
}
