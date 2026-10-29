import { promises as fs } from "node:fs";
import path from "node:path";
import { analyzeVideo, detectSilences, type Analysis } from "./analyzeVideo";
import { planEdit, type EditPlan, type PlanContext } from "./autoEdit";
import type { ClipProfile } from "./clipProfile";
import { findHighlights, type Highlight } from "./highlights";
import type { Seg, Word } from "./cutPlan";
import type { Look } from "./reframe";
import { probe } from "./render";
import { trackSubject } from "./subjectTrack";
import type { Detector } from "./subjectDetector";
import { transcribeVideo, transcribeWords, type Transcriber } from "./transcribe";
import { addMeta, timed, tracked } from "./usage";
import { fetchSignals, momentsHint } from "./urlPlan";

export type AutoJob = {
  status: "running" | "done" | "error";
  stage: string;
  error?: string;
  plan?: EditPlan;
  highlights?: Highlight[];
  /** the silences (and, if asked for, the words) found by an auto-cut analysis; the page turns them into cuts */
  cut?: CutAnalysis;
  /** what happened to the original-video address, when one was given: used, or why it was not */
  hintNote?: string;
  /** why a requested long-form summary was not made (for example the video is too short) */
  longformNote?: string;
  /** the channel's length range for Shorts, when there is enough history; shown beside the candidates */
  lengthRange?: { min: number; max: number } | null;
  duration?: number;
  /** who and what was found over the video, by an auto-reframe run; the page picks what to follow and smooths it into a camera path */
  reframe?: ReframeAnalysis;
  /** how far along the picture-by-picture search is */
  progress?: number;
};

/** What a person search found. The camera path is worked out on the page so smoothness can change without a new run. */
export type ReframeAnalysis = {
  duration: number;
  width: number;
  height: number;
  looks: Look[];
  thumbs: { t: number; dataUrl: string }[];
};

/** What an auto-cut analysis found. Which of it becomes a cut is decided on the page, so settings can change without a new run. */
export type CutAnalysis = {
  duration: number;
  width?: number;
  height?: number;
  /** quiet stretches at the threshold given, of 0.3 s or longer */
  silences: Seg[];
  /** every spoken word with its time; empty unless filler words were asked for */
  words: Word[];
  fillersAnalyzed: boolean;
  /** only the first 30 minutes are listened to for words */
  wordsTruncated: boolean;
};

// Analysis and planning take a minute or more, so they run in the background and the page polls.
const g = globalThis as unknown as { __autoJobs?: Map<string, AutoJob> };
const jobs = (g.__autoJobs ??= new Map<string, AutoJob>());

export const autoEditDir = () => path.join(process.cwd(), ".data", "autoedit");
export const getAutoJob = (id: string) => jobs.get(id) ?? null;

type Common = {
  id: string;
  dir: string;
  input: string;
  deleteInput: boolean;
  /** turn speech into text on this computer and hand it to the model (first use downloads the model) */
  speech?: { language?: string; transcriber?: Transcriber };
};

/** Shared by both jobs: look at the file, optionally transcribe it, run `finish`, then clean up. */
function start(args: Common, kind: string, maxFrames: number | undefined, finish: (a: Analysis, job: AutoJob) => Promise<void>) {
  const job: AutoJob = { status: "running", stage: "시작하는 중" };
  jobs.set(args.id, job);
  void (async () => {
    try {
      // One measured piece of work: AI calls and stage times made below are added to its record.
      await tracked(kind, async () => {
        const analysis = await timed("ffmpeg 분석", () => analyzeVideo(args.input, args.dir, (s) => (job.stage = s), { maxFrames }));
        addMeta({ inputSec: Math.round(analysis.duration), frames: analysis.frames.length, hasAudio: analysis.hasAudio, speech: !!args.speech });
        if (args.speech && analysis.hasAudio) {
          analysis.speech = await timed("음성 인식", () =>
            transcribeVideo(args.input, args.dir, {
              duration: analysis.duration,
              silences: analysis.silences,
              language: args.speech?.language,
              transcriber: args.speech?.transcriber,
              onStage: (s) => (job.stage = s),
            }),
          );
        }
        job.duration = analysis.duration;
        await finish(analysis, job);
      });
      job.status = "done";
      job.stage = "완료";
    } catch (e) {
      job.status = "error";
      job.error = e instanceof Error ? e.message : "분석에 실패했습니다.";
    } finally {
      if (args.deleteInput) await fs.rm(args.input, { force: true });
      await fs.rm(args.dir, { recursive: true, force: true }); // frames are only needed for the model call
    }
  })();
}

/** Analyse the video, ask the model for an edit plan, then clean up. Rendering is a separate, explicit step. */
export function startAutoEdit(args: Common & { ctx: PlanContext }) {
  start(args, "autoedit", undefined, async (analysis, job) => {
    job.stage = "AI가 편집 계획을 세우는 중";
    job.plan = await planEdit(analysis, args.ctx);
  });
}

/** Analyse a long video and ask the model which stretches would work as Shorts. */
export function startHighlights(
  args: Common & {
    topic: string;
    count: number;
    longform?: boolean;
    /** address of the original YouTube video, so the moments its viewers point at can guide the choice */
    sourceUrl?: string;
    /** what has worked on the creator's channel, if the caller can tell (the app layer passes the channel analysis); none by default */
    loadProfile?: () => Promise<ClipProfile | null>;
  },
) {
  // A long video needs more sample frames than a short clip to be covered at all.
  start(args, "highlights", 24, async (analysis, job) => {
    job.stage = "내 채널에서 잘된 쇼츠 확인하는 중";
    // Not signed in, no quota, or too few Shorts: carry on without channel history rather than fail the whole search.
    const profile = await (args.loadProfile ?? (async () => null))().catch(() => null);
    job.lengthRange = profile?.lengthRange ?? null;

    // The original video's address: what its viewers pointed at in the comments. A failure only costs the hint.
    let moments: Awaited<ReturnType<typeof momentsHint>>["moments"] = [];
    if (args.sourceUrl?.trim()) {
      job.stage = "원본 영상의 시청자 반응 읽는 중";
      try {
        const hint = momentsHint(await fetchSignals(args.sourceUrl), analysis.duration);
        moments = hint.moments;
        job.hintNote = hint.note ?? `원본 영상에서 시청자가 짚은 순간 ${moments.length}곳을 후보 선정에 반영했습니다.`;
      } catch (e) {
        job.hintNote = `원본 영상 주소를 읽지 못해 파일만 분석했습니다: ${e instanceof Error ? e.message : "알 수 없는 오류"}`;
      }
    }

    job.stage = "AI가 쇼츠 구간을 고르는 중";
    job.highlights = await findHighlights(analysis, { topic: args.topic, count: args.count, profile, moments });

    // Optionally also a long-form summary of the same video, from the same analysis: cuts, chapters, title and description.
    if (args.longform) {
      if (analysis.duration < MIN_LONGFORM_SOURCE_SEC) {
        job.longformNote = "영상이 2분보다 짧아 롱폼 요약은 만들지 않았습니다.";
      } else {
        job.stage = "AI가 롱폼 요약 구성을 짜는 중";
        job.plan = await planEdit(analysis, { layout: "long", topic: args.topic, targetSec: longformTarget(analysis.duration) });
      }
    }
  });
}

export const MIN_LONGFORM_SOURCE_SEC = 120;

/** About half of the source, but at least a minute and at most 15 minutes: a summary, not a re-upload. */
export const longformTarget = (durationSec: number) => Math.min(900, Math.max(60, Math.round(durationSec * 0.5)));

/**
 * Listens to a video for jump cuts: where it is quiet and, optionally, which words are hesitation sounds. No pictures are
 * looked at and nothing is sent to an AI service; it all happens on this computer.
 */
export function startAutoCut(args: {
  id: string;
  dir: string;
  input: string;
  deleteInput: boolean;
  /** quieter than this many dB counts as silence */
  noiseDb: number;
  /** also find hesitation words (needs the speech model) */
  fillers: boolean;
  transcriber?: Transcriber;
}) {
  const job: AutoJob = { status: "running", stage: "소리 분석 중" };
  jobs.set(args.id, job);
  void (async () => {
    try {
      await tracked("autocut", async () => {
        const found = await timed("무음 분석", () => detectSilences(args.input, args.dir, { noiseDb: args.noiseDb, minSec: 0.3 }));
        if (!found.hasAudio) throw new Error("이 영상에는 소리가 없어 무음·군말을 찾을 수 없습니다.");
        addMeta({ inputSec: Math.round(found.duration), silences: found.silences.length, fillers: args.fillers });
        let words: Word[] = [];
        let wordsTruncated = false;
        if (args.fillers) {
          const w = await timed("음성 인식(군말)", () =>
            transcribeWords(args.input, args.dir, {
              duration: found.duration,
              silences: found.silences,
              transcriber: args.transcriber,
              onStage: (s) => (job.stage = s),
            }),
          );
          words = w.words;
          wordsTruncated = w.truncated;
        }
        job.cut = {
          duration: found.duration,
          width: found.width,
          height: found.height,
          silences: found.silences,
          words,
          fillersAnalyzed: args.fillers,
          wordsTruncated,
        };
        job.duration = found.duration;
      });
      job.status = "done";
      job.stage = "완료";
    } catch (e) {
      job.status = "error";
      job.error = e instanceof Error ? e.message : "분석에 실패했습니다.";
    } finally {
      if (args.deleteInput) await fs.rm(args.input, { force: true });
      await fs.rm(args.dir, { recursive: true, force: true });
    }
  })();
}

/**
 * Looks through a video for the person to follow when it is cut to a vertical frame. Stills are taken every so often and a small
 * model on this computer finds people in them; nothing is sent anywhere.
 */
export function startAutoReframe(args: {
  id: string;
  dir: string;
  input: string;
  deleteInput: boolean;
  detector?: Detector;
}) {
  const job: AutoJob = { status: "running", stage: "영상 확인 중", progress: 0 };
  jobs.set(args.id, job);
  void (async () => {
    try {
      await tracked("autoreframe", async () => {
        await fs.mkdir(args.dir, { recursive: true });
        const info = await probe(args.input, args.dir);
        if (!info.width || !info.height) throw new Error("영상 크기를 읽지 못했습니다.");
        if (info.width <= info.height) throw new Error("이미 세로 영상이라 따로 자를 필요가 없습니다.");
        addMeta({ inputSec: Math.round(info.duration) });
        const track = await timed("사람 찾기", () =>
          trackSubject(args.input, args.dir, {
            duration: info.duration,
            width: info.width!,
            height: info.height!,
            detector: args.detector,
            thumbs: 12,
            onStage: (s) => (job.stage = s),
            onProgress: (d, t) => (job.progress = t ? d / t : 0),
          }),
        );
        addMeta({ looks: track.looks.length });
        job.reframe = { duration: info.duration, width: info.width, height: info.height, looks: track.looks, thumbs: track.thumbs };
        job.duration = info.duration;
      });
      job.status = "done";
      job.stage = "완료";
    } catch (e) {
      job.status = "error";
      job.error = e instanceof Error ? e.message : "분석에 실패했습니다.";
    } finally {
      if (args.deleteInput) await fs.rm(args.input, { force: true });
      await fs.rm(args.dir, { recursive: true, force: true });
    }
  })();
}
