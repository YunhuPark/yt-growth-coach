import { promises as fs } from "node:fs";
import path from "node:path";
import { withAutoReframe } from "./autoReframe";
import { withBeatEffects } from "./beatEffects";
import type { Target } from "./reframe";
import { renderVideo, type RenderOpts } from "./render";
import { addMeta, timed, tracked } from "../shared/usage";

export type RenderResult = { durationSec: number; bytes: number; layout: "short" | "long"; /** how many transitions and sounds were put in, when effects were asked for */ effects?: { transitions: number; sounds: number } };
export type Job = {
  status: "running" | "done" | "error";
  progress: number;
  error?: string;
  result?: RenderResult;
  /** what it is doing now, when that is more than just encoding (finding the person to follow) */
  stage?: string;
  /** something the person should know about the result, such as tracking that found few people */
  note?: string;
};

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
  /** find who to follow in the parts that are used, and crop the vertical result around them */
  autoReframe?: { smooth?: number; target?: Target; zoom?: number | "auto" };
}) {
  const job: Job = { status: "running", progress: 0 };
  jobs.set(args.id, job);
  void (async () => {
    try {
      const result = await tracked(
        "render",
        async () => {
          let opts = args.opts;
          if (args.autoReframe) {
            const tracked = await timed("사람 찾기", () => withAutoReframe(args.input, args.dir, opts, { ...args.autoReframe, onStage: (s) => (job.stage = s) }));
            opts = tracked.opts;
            job.note = tracked.note;
          }
          const beat = await timed("박자 찾기", () => withBeatEffects(args.input, args.dir, opts, { onStage: (st) => (job.stage = st) }));
          opts = beat.opts;
          if (beat.note) job.note = job.note ? `${job.note} ${beat.note}` : beat.note;
          job.stage = undefined;
          const r = await renderVideo(args.input, args.dir, opts, (f) => {
            job.progress = f;
          });
          addMeta({ outputSec: r.durationSec, bytes: r.bytes });
          if (r.effects && r.effects.transitions + r.effects.sounds === 0) {
            const why = "전환·효과음을 넣을 곳이 없었습니다(컷이 없거나, 컷에서 건너뛴 길이가 1초 미만이거나, 후크·엔딩이 없음).";
            job.note = job.note ? `${job.note} ${why}` : why;
          }
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
