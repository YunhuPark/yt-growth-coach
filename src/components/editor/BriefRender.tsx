"use client";

import { useState } from "react";
import { editedCaptions, toCaps, type Cap } from "@/lib/editor/captionEdit";
import { formatClock } from "@/lib/editor/chapters";
import { planCues } from "@/lib/editor/exporters";
import { lengthMismatch, MISMATCH_LIMIT } from "@/lib/editor/mismatch";
import type { RangeInfo } from "@/lib/editor/rangeCaptions";
import type { UrlCandidate, UrlVideo } from "@/lib/editor/urlPlan";
import { useCaptionStyle } from "../editor/captionStyleContext";
import { useEffectsOption } from "../editor/effectsContext";
import { useReframeOption } from "../editor/framingContext";
import CaptionEditor from "../editor/CaptionEditor";
import ExportMenu from "../editor/ExportMenu";
import { api, type Basis } from "../shared";

type RenderStatus = { status: "running" | "done" | "error"; progress: number; stage?: string; note?: string; error?: string; result?: { durationSec: number; bytes: number } };
type Prepared = { info: RangeInfo; caps: Cap[]; hook: string };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Turns one edit brief into a Short, given a file of the original video the creator already has: checks the file against the
 * original's length, fills in the dialogue captions for the range, lets the creator fix hook and captions, then renders.
 */
export default function BriefRender({
  c,
  video,
  file,
  sourcePath,
  basis,
  speech,
  ready,
  clipName,
}: {
  c: UrlCandidate;
  video: UrlVideo;
  file: File | null;
  sourcePath: string;
  basis: Basis | "";
  speech: boolean;
  /** a file or path is chosen and the rights confirmation is done */
  ready: boolean;
  /** the source video's name, written into the exported cut list */
  clipName: string;
}) {
  const { style } = useCaptionStyle();
  const effects = useEffectsOption();
  const reframe = useReframeOption("short");
  const [busy, setBusy] = useState<"prepare" | "render" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [okMismatch, setOkMismatch] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [out, setOut] = useState<{ id: string; durationSec: number; bytes: number } | null>(null);

  const form = (options: object) => {
    const fd = new FormData();
    if (file) fd.append("file", file);
    fd.append("options", JSON.stringify({ ...options, sourcePath: !file && sourcePath ? sourcePath : undefined, rights: { confirmed: true, basis } }));
    return fd;
  };

  const prepare = async () => {
    setBusy("prepare");
    setError(null);
    setOut(null);
    setOkMismatch(false);
    try {
      const res = await fetch("/api/rangecaptions", { method: "POST", body: form({ start: c.start, end: c.end, speech }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `준비 실패 (${res.status})`);
      const info = json as RangeInfo;
      setPrep({ info, caps: toCaps(info.captions), hook: c.hook });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const mismatch = prep ? lengthMismatch(prep.info.fileDurationSec, video.durationSec) > MISMATCH_LIMIT : false;

  const render = async () => {
    if (!prep) return;
    setBusy("render");
    setError(null);
    setProgress(0);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        body: form({
          layout: "short",
          fit: "blur",
          segments: [{ start: prep.info.start, end: prep.info.end }],
          hook: prep.hook.trim() ? { text: prep.hook, seconds: 2.5 } : undefined,
          captions: editedCaptions(prep.caps),
          style,
          effects,
          reframe,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `렌더링 실패 (${res.status})`);
      for (;;) {
        await wait(1000);
        const st = await api<RenderStatus>(`/api/render/status?id=${json.id}`);
        setProgress(st.progress);
        setStage(st.stage ?? null);
        if (st.status === "error") throw new Error(st.error ?? "렌더링에 실패했습니다.");
        if (st.status === "done" && st.result) {
          setOut({ id: json.id, ...st.result });
          setNote(st.note ?? null);
          // So it can later be linked to the uploaded video and its AI score checked against the real result.
          fetch("/api/clips", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: json.id,
              sourceName: video.title,
              aiScore: c.score,
              reason: c.reason,
              title: c.title,
              hook: prep.hook,
              start: c.start,
              end: c.end,
              lengthFit: c.lengthFit ?? null,
            }),
          }).catch(() => {});
          break;
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-2">
      {!prep && (
        <button className="btn w-fit" onClick={prepare} disabled={!ready || busy !== null}>
          {busy === "prepare" ? (speech ? "파일 확인과 음성 인식 중…" : "파일 확인 중…") : "이 지시서로 쇼츠 만들기"}
        </button>
      )}
      {!ready && !prep && <p className="text-xs text-muted">위의 “파일로 바로 만들기”에서 파일과 권한 확인을 먼저 채워 주세요.</p>}
      {error && <p className="text-sm text-bad">{error}</p>}

      {prep && (
        <div className="flex flex-col gap-2">
          {mismatch && (
            <div className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm">
              <p className="text-bad">
                파일 길이({formatClock(prep.info.fileDurationSec)})가 원본 영상({formatClock(video.durationSec)})과 다릅니다. 잘라 낸 편집본이거나 다른 버전이면 구간 시간이
                어긋나 엉뚱한 장면이 나올 수 있습니다.
              </p>
              <label className="mt-1 flex items-center gap-2 text-xs">
                <input type="checkbox" checked={okMismatch} onChange={(e) => setOkMismatch(e.target.checked)} />
                그래도 이 시간대로 만듭니다
              </label>
            </div>
          )}
          <label className="field">훅 자막
            <input className="input" value={prep.hook} onChange={(e) => setPrep({ ...prep, hook: e.target.value })} />
          </label>
          <details className="rounded-md border border-line px-3 py-2" open={prep.caps.length > 0}>
            <summary className="cursor-pointer text-sm">
              자막 {editedCaptions(prep.caps).length}줄 {speech ? (prep.info.hasAudio ? "(음성 인식 결과 · 틀린 글자를 고치세요)" : "(파일에 소리가 없습니다)") : "(음성 인식을 껐습니다 · 직접 추가할 수 있습니다)"}
            </summary>
            <CaptionEditor
              caps={prep.caps}
              max={Math.round((prep.info.end - prep.info.start) * 10) / 10}
              onChange={(next) => setPrep({ ...prep, caps: next })}
              onReset={() => setPrep({ ...prep, caps: toCaps(prep.info.captions) })}
            />
          </details>
          <ExportMenu
            baseName={c.title || "쇼츠"}
            clipName={clipName}
            cues={planCues({
              hook: prep.hook.trim() ? { text: prep.hook, seconds: 2.5 } : null,
              captions: editedCaptions(prep.caps),
              outputSec: prep.info.end - prep.info.start,
            })}
            cuts={[{ start: prep.info.start, end: prep.info.end }]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" onClick={render} disabled={busy !== null || (mismatch && !okMismatch)}>
              {busy === "render" ? (stage ? `${stage}…` : `만드는 중… ${Math.round(progress * 100)}%`) : out ? "다시 만들기" : "쇼츠 만들기"}
            </button>
            <button className="text-xs text-muted hover:underline" onClick={() => { setPrep(null); setOut(null); }} disabled={busy !== null}>파일 다시 고르기</button>
          </div>
          {busy === "render" && (
            <div className="h-2 w-full max-w-md overflow-hidden rounded bg-line" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
              <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          {out && (
            <div className="flex flex-col items-start gap-2">
              <video className="max-h-[480px] max-w-full rounded-md border border-line" controls src={`/api/render/file?id=${out.id}`} />
              <p className="text-xs text-muted">{out.durationSec}초 · {(out.bytes / 1024 / 1024).toFixed(1)}MB · 올린 뒤 성과 추적의 “AI 점수 검증”에서 올린 영상에 연결할 수 있습니다</p>
              {note && <p className="text-xs text-bad">{note}</p>}
              <a className="btn-primary" href={`/api/render/file?id=${out.id}&download=1`}>mp4 다운로드</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
