import { promises as fs } from "node:fs";
import path from "node:path";
import type { Silence } from "./analyzeVideo";
import { run } from "./render";

// Speech-to-text that runs on this computer (Whisper through transformers.js / ONNX). The model is downloaded once,
// on first use, into .data/models and works offline afterwards. Audio never leaves the machine; only the resulting text
// goes to the model that plans the edit.

export const SPEECH_MODEL = "Xenova/whisper-small";
export const SPEECH_MODEL_SIZE_MB = 240;
/** Longest stretch transcribed in one go; beyond this the rest is left out (and the plan says so). */
export const MAX_TRANSCRIBE_SEC = 30 * 60;

export type Speech = { start: number; end: number; text: string };
export type Transcript = { segments: Speech[]; truncated: boolean };

/** What the real speech engine looks like to this module, so tests can swap in a fake. */
export type Transcriber = (samples: Float32Array, opts: { language: string }) => Promise<Speech[]>;

export const modelsDir = () => path.join(process.cwd(), ".data", "models");

/** Whisper tends to invent text over silence or noise: stock phrases and the same line over and over. */
const STOCK = /^(?:자막\s*제공|시청해\s*주셔서\s*감사합니다\.?|구독과\s*좋아요|MBC\s*뉴스|감사합니다\.?|thank you\.?|thanks for watching\.?|\.+)$/i;

/** A news sign-off Whisper often invents after speech in Korean ("MBC 뉴스 김상현입니다"). */
const SIGN_OFF = /(?:MBC|KBS|SBS|JTBC|YTN|TV조선|채널A|MBN)\s*뉴스\s*[가-힣]{2,4}\s*(?:입니다|였습니다)\.?/g;

/**
 * Cleans raw recognition output: drops empty or stock-phrase lines, repeats of the previous line, lines that sit almost
 * entirely inside a detected silence, and anything outside the file. Sorted by start time.
 */
export function cleanTranscript(segments: Speech[], silences: Silence[], duration: number): Speech[] {
  const out: Speech[] = [];
  for (const s of [...segments].sort((a, b) => a.start - b.start)) {
    // U+FFFD marks bytes the decoder could not turn into a character; keeping it would put a broken glyph in a caption.
    const text = s.text.replace(SIGN_OFF, " ").replace(/�/g, "").replace(/\s+/g, " ").trim();
    if (!text || STOCK.test(text)) continue;
    const start = Math.max(0, s.start);
    const end = Math.min(duration, Math.max(s.end, start + 0.3));
    if (start >= duration) continue;
    const len = end - start;
    const quiet = silences.reduce((n, q) => n + Math.max(0, Math.min(end, q.end) - Math.max(start, q.start)), 0);
    if (len > 0 && quiet / len > 0.8) continue; // spoken over silence is not spoken
    if (out.length && out[out.length - 1].text === text) continue;
    out.push({ start, end, text });
  }
  return out;
}

/**
 * Moves each cut point that lands inside a spoken line to the nearer edge of that line, when the edge is within `reach`
 * seconds, so a cut doesn't chop a sentence in half. Segments are re-validated afterwards: ordered, no overlap, 0.8 s+.
 */
export function snapToSpeech(segments: { start: number; end: number; reason: string }[], speech: Speech[], reach = 1.5) {
  const snap = (t: number) => {
    const hit = speech.find((s) => t > s.start + 0.05 && t < s.end - 0.05);
    if (!hit) return t;
    const toStart = t - hit.start;
    const toEnd = hit.end - t;
    // Move to whichever edge of the line is closer: that keeps the whole line or drops it, never half of it.
    const target = toStart <= toEnd ? hit.start : hit.end;
    const dist = Math.min(toStart, toEnd);
    return dist <= reach ? target : t;
  };
  const moved = segments.map((s) => ({ ...s, start: snap(s.start), end: snap(s.end) }));
  const out: typeof moved = [];
  for (const s of moved) {
    if (s.end - s.start < 0.8) continue;
    const last = out[out.length - 1];
    if (last && s.start < last.end) s.start = last.end;
    if (s.end - s.start >= 0.8) out.push(s);
  }
  return out.length ? out : segments;
}

const SAMPLE_RATE = 16000;

/**
 * The stretches of the file that contain sound, from the detected silences. Whisper invents text over silence and
 * gets timestamps wrong across long pauses, so it is only shown these stretches, one at a time. Pauses shorter than
 * `joinGap` stay inside one stretch (a sentence with a breath in it is still one sentence); each stretch gets a little
 * padding so word edges aren't clipped. With no silences known the whole file is one stretch.
 */
export function speechRegions(silences: Silence[], duration: number, opts: { joinGap?: number; pad?: number; minLen?: number } = {}) {
  const { joinGap = 2, pad = 0.3, minLen = 0.5 } = opts;
  const spans: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const q of [...silences].sort((a, b) => a.start - b.start)) {
    if (q.start > cursor) spans.push({ start: cursor, end: q.start });
    cursor = Math.max(cursor, q.end);
  }
  if (cursor < duration) spans.push({ start: cursor, end: duration });

  const joined: typeof spans = [];
  for (const s of spans) {
    const last = joined[joined.length - 1];
    if (last && s.start - last.end < joinGap) last.end = s.end;
    else joined.push({ ...s });
  }
  return joined
    .filter((s) => s.end - s.start >= minLen)
    .map((s) => ({ start: Math.max(0, s.start - pad), end: Math.min(duration, s.end + pad) }));
}

/** 16 kHz mono float samples, the format Whisper expects, read through ffmpeg. */
export async function extractAudio(input: string, dir: string, maxSec = MAX_TRANSCRIBE_SEC): Promise<Float32Array> {
  await fs.mkdir(dir, { recursive: true });
  const file = "speech.f32";
  const { code, stderr } = await run(
    ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-vn", "-t", String(maxSec), "-ac", "1", "-ar", "16000", "-f", "f32le", file],
    dir,
    10 * 60_000,
  );
  if (code !== 0) throw new Error(`음성을 추출하지 못했습니다: ${stderr.trim().split("\n").slice(-2).join(" ").slice(0, 200)}`);
  const buf = await fs.readFile(path.join(dir, file));
  await fs.rm(path.join(dir, file), { force: true });
  // Copy into a fresh, aligned buffer: a Node Buffer's backing store may not start on a 4-byte boundary.
  const copy = new Uint8Array(buf.byteLength - (buf.byteLength % 4));
  copy.set(buf.subarray(0, copy.byteLength));
  return new Float32Array(copy.buffer);
}

type Progress = { status?: string; file?: string; progress?: number };
type AsrOutput = { chunks?: { text: string; timestamp: [number, number | null] }[] };
type Asr = (audio: Float32Array, o: Record<string, unknown>) => Promise<AsrOutput | AsrOutput[]>;

const g = globalThis as unknown as { __asr?: Promise<Asr> };

/** The real engine. Loaded once and kept; the first call downloads the model (reporting progress). */
export function whisperTranscriber(onProgress?: (p: Progress) => void): Transcriber {
  return async (samples, { language }) => {
    g.__asr ??= (async () => {
      // Dynamic import: the engine only loads when speech recognition is actually used.
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = modelsDir();
      const load = pipeline as unknown as (task: string, model: string, o: Record<string, unknown>) => Promise<Asr>;
      return load("automatic-speech-recognition", SPEECH_MODEL, {
        dtype: "q8",
        progress_callback: (p: Progress) => onProgress?.(p),
      });
    })().catch((e) => {
      g.__asr = undefined; // let the next try start again instead of keeping a failed load
      throw new Error(`음성 인식 모델을 준비하지 못했습니다(인터넷 연결 확인): ${e instanceof Error ? e.message : e}`);
    });
    const asr = await g.__asr;
    const res = await asr(samples, { language, task: "transcribe", return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 });
    const chunks = (Array.isArray(res) ? res[0] : res).chunks ?? [];
    return chunks.map((c) => ({ start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 2, text: c.text }));
  };
}

export async function transcribeVideo(
  input: string,
  dir: string,
  opts: { duration: number; silences: Silence[]; language?: string; transcriber?: Transcriber; onStage?: (s: string) => void },
): Promise<Transcript> {
  const seconds = Math.min(opts.duration, MAX_TRANSCRIBE_SEC);
  opts.onStage?.("음성 추출 중");
  const samples = await extractAudio(input, dir, seconds);

  let lastShown = -1;
  const transcriber =
    opts.transcriber ??
    whisperTranscriber((p) => {
      // "progress_total" is the library's combined figure across all model files (the per-file ones jump around).
      if (p.status === "progress_total" && p.progress !== undefined && p.progress < 100 && Math.floor(p.progress / 10) !== lastShown) {
        lastShown = Math.floor(p.progress / 10);
        opts.onStage?.(`음성 인식 모델 내려받는 중 (처음 한 번, 약 ${SPEECH_MODEL_SIZE_MB}MB) ${Math.round(p.progress)}%`);
      }
    });
  const language = opts.language ?? "korean";
  const regions = speechRegions(opts.silences, seconds);
  const raw: Speech[] = [];
  for (const [i, r] of regions.entries()) {
    opts.onStage?.(`음성 인식 중 ${i + 1}/${regions.length} (영상 길이에 따라 몇 분)`);
    const piece = samples.slice(Math.floor(r.start * SAMPLE_RATE), Math.min(samples.length, Math.ceil(r.end * SAMPLE_RATE)));
    for (const s of await transcriber(piece, { language })) raw.push({ start: s.start + r.start, end: s.end + r.start, text: s.text });
  }
  return {
    segments: cleanTranscript(raw, opts.silences, seconds),
    truncated: opts.duration > MAX_TRANSCRIBE_SEC,
  };
}
