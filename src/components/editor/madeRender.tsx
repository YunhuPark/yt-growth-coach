"use client";

import { api } from "../shared";

/** One render started from a tool, as the page follows it: running with a progress, then done with the file or failed. */
export type Made = { state: "running" | "done" | "error"; progress: number; stage?: string; id?: string; durationSec?: number; bytes?: number; error?: string; note?: string };
export type RenderStatus = { status: "running" | "done" | "error"; progress: number; stage?: string; note?: string; error?: string; result?: { durationSec: number; bytes: number } };

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The label of a button that starts a render: its own words while idle, the stage or the percentage while running. */
export const runningLabel = (job: Made | undefined, idle: string) => (job?.state === "running" ? (job.stage ? `${job.stage}…` : `만드는 중… ${Math.round(job.progress * 100)}%`) : idle);

/** The progress, the result video and the download of one render started from a tool. */
export function MadeResult({ job }: { job: Made | undefined }) {
  if (!job) return null;
  return (
    <div className="mt-3 flex w-full flex-col items-start gap-2">
      {job.state === "running" && (
        <div className="h-2 w-full max-w-md overflow-hidden rounded bg-line" role="progressbar" aria-valuenow={Math.round(job.progress * 100)} aria-label="만드는 중">
          <div className="h-full bg-foreground transition-all" style={{ width: `${Math.round(job.progress * 100)}%` }} />
        </div>
      )}
      {job.state === "error" && <p className="text-sm text-bad" role="alert">{job.error}</p>}
      {job.state === "done" && job.id && (
        <>
          <video className="max-h-[420px] max-w-full rounded-md border border-line" controls src={`/api/render/file?id=${job.id}`} />
          {job.note && <p className="text-xs text-bad">{job.note}</p>}
          <p className="text-xs text-muted">{job.durationSec}초 · {((job.bytes ?? 0) / 1024 / 1024).toFixed(1)}MB</p>
          <a className="btn-primary" href={`/api/render/file?id=${job.id}&download=1`}>mp4 다운로드</a>
        </>
      )}
    </div>
  );
}

/** Posts a render request and follows it to the end, reporting each change through `patch`. */
export async function followRender(body: FormData, patch: (m: Partial<Made>) => void): Promise<void> {
  patch({ state: "running", progress: 0, error: undefined, id: undefined, note: undefined, stage: undefined });
  try {
    const res = await fetch("/api/render", { method: "POST", body });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `렌더링 실패 (${res.status})`);
    for (;;) {
      await wait(1000);
      const st = await api<RenderStatus>(`/api/render/status?id=${json.id}`);
      patch({ progress: st.progress, stage: st.stage });
      if (st.status === "error") throw new Error(st.error ?? "렌더링에 실패했습니다.");
      if (st.status === "done" && st.result) {
        patch({ state: "done", progress: 1, stage: undefined, id: json.id, durationSec: st.result.durationSec, bytes: st.result.bytes, note: st.note });
        return;
      }
    }
  } catch (e) {
    patch({ state: "error", error: (e as Error).message });
  }
}
