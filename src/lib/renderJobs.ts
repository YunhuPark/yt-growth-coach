import { promises as fs } from "node:fs";
import path from "node:path";
import { renderVideo, type RenderOpts } from "./render";
import { addMeta, tracked } from "./usage";

export type RenderResult = { durationSec: number; bytes: number; layout: "short" | "long" };
export type Job = { status: "running" | "done" | "error"; progress: number; error?: string; result?: RenderResult };

// Long renders take minutes, so they run in the background and the page polls for progress.
// Next dev can reload modules, so the registry lives on globalThis.
const g = globalThis as unknown as { __renderJobs?: Map<string, Job> };
const jobs = (g.__renderJobs ??= new Map<string, Job>());

export const rendersDir = () => path.join(process.cwd(), ".data", "renders");

export function startRenderJob(args: {
  id: string;
  dir: string;
  input: string;
  opts: RenderOpts;
  meta: Record<string, unknown>;
  /** delete the input afterwards (true for uploads, never for a path the creator pointed us at) */
  deleteInput: boolean;
}) {
  const job: Job = { status: "running", progress: 0 };
  jobs.set(args.id, job);
  void (async () => {
    try {
      const result = await tracked(
        "render",
        async () => {
          const r = await renderVideo(args.input, args.dir, args.opts, (f) => {
            job.progress = f;
          });
          addMeta({ outputSec: r.durationSec, bytes: r.bytes });
          return r;
        },
        { layout: args.opts.layout ?? "short", cuts: args.opts.segments?.length ?? 1 },
      );
      await fs.writeFile(
        path.join(args.dir, "meta.json"),
        JSON.stringify({ at: new Date().toISOString(), ...args.meta, ...result }, null, 2),
        "utf8",
      );
      job.result = result;
      job.progress = 1;
      job.status = "done";
    } catch (e) {
      job.status = "error";
      job.error = e instanceof Error ? e.message : "렌더링에 실패했습니다.";
    } finally {
      if (args.deleteInput) await fs.rm(args.input, { force: true });
    }
  })();
}

/** Live job state, or - after a server restart - the finished result recorded on disk. */
export async function getJob(id: string): Promise<Job | null> {
  const live = jobs.get(id);
  if (live) return live;
  try {
    const meta = JSON.parse(await fs.readFile(path.join(rendersDir(), id, "meta.json"), "utf8"));
    return {
      status: "done",
      progress: 1,
      result: { durationSec: meta.durationSec, bytes: meta.bytes, layout: meta.layout ?? "short" },
    };
  } catch {
    return null;
  }
}
