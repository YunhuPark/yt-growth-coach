import { promises as fs } from "node:fs";
import path from "node:path";
import { analyzeVideo } from "./analyzeVideo";
import { planEdit, type EditPlan, type PlanContext } from "./autoEdit";

export type AutoJob = { status: "running" | "done" | "error"; stage: string; error?: string; plan?: EditPlan; duration?: number };

// Analysis and planning take a minute or more, so they run in the background and the page polls.
const g = globalThis as unknown as { __autoJobs?: Map<string, AutoJob> };
const jobs = (g.__autoJobs ??= new Map<string, AutoJob>());

export const autoEditDir = () => path.join(process.cwd(), ".data", "autoedit");
export const getAutoJob = (id: string) => jobs.get(id) ?? null;

/** Analyse the video, ask the model for a plan, then clean up. Rendering is a separate, explicit step. */
export function startAutoEdit(args: { id: string; dir: string; input: string; ctx: PlanContext; deleteInput: boolean }) {
  const job: AutoJob = { status: "running", stage: "시작하는 중" };
  jobs.set(args.id, job);
  void (async () => {
    try {
      const analysis = await analyzeVideo(args.input, args.dir, (s) => (job.stage = s));
      job.stage = "AI가 편집 계획을 세우는 중";
      job.plan = await planEdit(analysis, args.ctx);
      job.duration = analysis.duration;
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
