import { promises as fs } from "node:fs";
import path from "node:path";
import { analyzeVideo, type Analysis } from "./analyzeVideo";
import { planEdit, type EditPlan, type PlanContext } from "./autoEdit";
import { getAnalysis } from "./analysis";
import { buildClipProfile, type ClipProfile } from "./clipProfile";
import { findHighlights, type Highlight } from "./highlights";
import { transcribeVideo, type Transcriber } from "./transcribe";

export type AutoJob = {
  status: "running" | "done" | "error";
  stage: string;
  error?: string;
  plan?: EditPlan;
  highlights?: Highlight[];
  /** why a requested long-form summary was not made (for example the video is too short) */
  longformNote?: string;
  /** the channel's length range for Shorts, when there is enough history; shown beside the candidates */
  lengthRange?: { min: number; max: number } | null;
  duration?: number;
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
function start(args: Common, maxFrames: number | undefined, finish: (a: Analysis, job: AutoJob) => Promise<void>) {
  const job: AutoJob = { status: "running", stage: "시작하는 중" };
  jobs.set(args.id, job);
  void (async () => {
    try {
      const analysis = await analyzeVideo(args.input, args.dir, (s) => (job.stage = s), { maxFrames });
      if (args.speech && analysis.hasAudio) {
        analysis.speech = await transcribeVideo(args.input, args.dir, {
          duration: analysis.duration,
          silences: analysis.silences,
          language: args.speech.language,
          transcriber: args.speech.transcriber,
          onStage: (s) => (job.stage = s),
        });
      }
      job.duration = analysis.duration;
      await finish(analysis, job);
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
  start(args, undefined, async (analysis, job) => {
    job.stage = "AI가 편집 계획을 세우는 중";
    job.plan = await planEdit(analysis, args.ctx);
  });
}

/** Analyse a long video and ask the model which stretches would work as Shorts. */
export function startHighlights(
  args: Common & { topic: string; count: number; longform?: boolean; loadProfile?: () => Promise<ClipProfile | null> },
) {
  // A long video needs more sample frames than a short clip to be covered at all.
  start(args, 24, async (analysis, job) => {
    job.stage = "내 채널에서 잘된 쇼츠 확인하는 중";
    // Not signed in, no quota, or too few Shorts: carry on without channel history rather than fail the whole search.
    const profile = await (args.loadProfile ?? defaultProfile)().catch(() => null);
    job.lengthRange = profile?.lengthRange ?? null;
    job.stage = "AI가 쇼츠 구간을 고르는 중";
    job.highlights = await findHighlights(analysis, { topic: args.topic, count: args.count, profile });

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

const defaultProfile = async () => {
  const a = await getAnalysis();
  return buildClipProfile(a.videos, a.patterns);
};
