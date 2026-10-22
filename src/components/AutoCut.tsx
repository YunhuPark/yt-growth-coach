"use client";

import { useMemo, useState } from "react";
import { formatClock } from "@/lib/chapters";
import { cutStats, DEFAULT_CUT_OPTIONS, keepSegments, MAX_PIECES, planRemovals, type CutOptions, type Removal } from "@/lib/cutPlan";
import type { CutAnalysis } from "@/lib/autoEditJobs";
import { useCaptionStyle } from "./captionStyleContext";
import { useReframeOption } from "./framingContext";
import ExportMenu from "./ExportMenu";
import RangePreview from "./RangePreview";
import { api } from "./shared";
import { hasSource, sourceName, sourceReady, type SourceState } from "./source";

type AutoStatus = { status: "running" | "done" | "error"; stage: string; error?: string; cut?: CutAnalysis };
type RenderStatus = { status: "running" | "done" | "error"; progress: number; stage?: string; note?: string; error?: string; result?: { durationSec: number; bytes: number } };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = (r: Removal) => `${r.kind}:${r.start.toFixed(2)}`;
const sec = (s: number) => (s >= 90 ? `${Math.floor(s / 60)}분 ${Math.round(s % 60)}초` : `${Math.round(s * 10) / 10}초`);

const SENSITIVITY: { db: number; label: string }[] = [
  { db: -42, label: "조용한 방에서 녹음 (작은 소리도 말로 봄)" },
  { db: -35, label: "보통" },
  { db: -28, label: "주변 소음이 있음 (소음을 조용한 것으로 봄)" },
];

/**
 * Cuts the dead air and the "음..." out of a talking video. The sound is analysed once; what actually gets cut is worked out on
 * the page, so the sliders answer instantly and every single cut can be switched off after listening to it.
 */
export default function AutoCut({ source }: { source: SourceState }) {
  const { file, sourcePath, basis } = source;
  const { style } = useCaptionStyle();
  const follow = useReframeOption("short");
  const [opts, setOpts] = useState<CutOptions>(DEFAULT_CUT_OPTIONS);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{ cut: CutAnalysis; noiseDb: number } | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState<"long" | "short" | "auto">("auto");
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [renderStage, setRenderStage] = useState<string | null>(null);
  const [renderNote, setRenderNote] = useState<string | null>(null);
  const [out, setOut] = useState<{ id: string; durationSec: number; bytes: number } | null>(null);

  const analyzing = stage !== null;
  const ready = sourceReady(source) && !analyzing && !rendering;
  const cut = found?.cut;

  const body = (options: object) => {
    const fd = new FormData();
    if (file) fd.append("file", file);
    fd.append("options", JSON.stringify({ ...options, sourcePath: !file && sourcePath.trim() ? sourcePath.trim() : undefined, rights: { confirmed: true, basis } }));
    return fd;
  };

  const analyze = async () => {
    setError(null);
    setFound(null);
    setOut(null);
    setOff(new Set());
    setStage("올리는 중");
    try {
      const res = await fetch("/api/autocut", { method: "POST", body: body({ noiseDb: opts.silence.noiseDb, fillers: opts.fillers.enabled }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `분석 실패 (${res.status})`);
      for (;;) {
        await wait(1000);
        const st = await api<AutoStatus>(`/api/autoedit/status?id=${json.id}`);
        setStage(st.stage);
        if (st.status === "error") throw new Error(st.error ?? "분석에 실패했습니다.");
        if (st.status === "done" && st.cut) {
          setFound({ cut: st.cut, noiseDb: opts.silence.noiseDb });
          break;
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStage(null);
    }
  };

  // Recomputed on every change of a slider or a switch; nothing here talks to the server.
  const removals = useMemo(() => (cut ? planRemovals(cut.silences, cut.words, opts) : []), [cut, opts]);
  const active = useMemo(() => removals.filter((r) => !off.has(key(r))), [removals, off]);
  const kept = useMemo(() => (cut ? keepSegments(cut.duration, active) : []), [cut, active]);
  const stats = cut ? cutStats(cut.duration, kept, active) : null;

  const needsReanalysis = !!found && (found.noiseDb !== opts.silence.noiseDb || (opts.fillers.enabled && !found.cut.fillersAnalyzed));
  const horizontal = !cut?.width || !cut?.height || cut.width >= cut.height;
  const useLayout = layout === "auto" ? (horizontal ? "long" : "short") : layout;
  const tooLongForShort = useLayout === "short" && !!stats && stats.keptSec > 180;
  const tooMany = !!stats && stats.pieces > MAX_PIECES;

  const set = <K extends keyof CutOptions>(k: K, patch: Partial<CutOptions[K]>) => setOpts({ ...opts, [k]: { ...opts[k], ...patch } });
  const toggle = (r: Removal) => {
    const next = new Set(off);
    if (next.has(key(r))) next.delete(key(r));
    else next.add(key(r));
    setOff(next);
  };

  const render = async () => {
    if (!kept.length) return;
    setError(null);
    setOut(null);
    setRenderNote(null);
    setRenderStage(null);
    setProgress(0);
    setRendering(true);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        body: body({ layout: useLayout, fit: "blur", segments: kept, captions: [], style, reframe: useLayout === "short" ? follow : undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `렌더링 실패 (${res.status})`);
      for (;;) {
        await wait(1000);
        const st = await api<RenderStatus>(`/api/render/status?id=${json.id}`);
        setProgress(st.progress);
        setRenderStage(st.stage ?? null);
        if (st.status === "error") throw new Error(st.error ?? "렌더링에 실패했습니다.");
        if (st.status === "done" && st.result) {
          setOut({ id: json.id, ...st.result });
          setRenderNote(st.note ?? null);
          break;
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRendering(false);
    }
  };

  return (
    <section className="card flex flex-col gap-4">
      <div>
        <h2 className="font-semibold">무음·군말 자동 컷</h2>
        <p className="text-xs text-muted">
          말하는 영상에서 말이 끊긴 빈 구간과 “음…”, “어…” 같은 군말을 잘라 내 템포를 빠르게 합니다. 소리 분석은 이 컴퓨터에서만 하고(AI 서비스로 보내지 않음), 무엇을 자를지는
          아래에서 하나씩 듣고 켜고 끌 수 있습니다.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="flex flex-col gap-2 rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-semibold text-muted">무음 자르기</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={opts.silence.enabled} onChange={(e) => set("silence", { enabled: e.target.checked })} />
            말이 없는 구간 자르기
          </label>
          <label className="field text-xs">녹음 환경
            <select className="input" value={opts.silence.noiseDb} onChange={(e) => set("silence", { noiseDb: Number(e.target.value) })}>
              {SENSITIVITY.map((s) => <option key={s.db} value={s.db}>{s.label}</option>)}
            </select>
          </label>
          <label className="field text-xs">이 길이 이상 조용하면 자름: <b>{opts.silence.minSec}초</b>
            <input type="range" min={0.3} max={2} step={0.1} value={opts.silence.minSec} onChange={(e) => set("silence", { minSec: Number(e.target.value) })} disabled={!opts.silence.enabled} />
          </label>
          <label className="field text-xs">자른 자리에 남길 숨: <b>{opts.silence.keepSec}초</b>
            <input type="range" min={0} max={0.6} step={0.05} value={opts.silence.keepSec} onChange={(e) => set("silence", { keepSec: Number(e.target.value) })} disabled={!opts.silence.enabled} />
          </label>
        </fieldset>

        <fieldset className="flex flex-col gap-2 rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-semibold text-muted">군말 자르기 (실험 기능)</legend>
          <label className="flex items-start gap-2 text-sm">
            <input className="mt-1" type="checkbox" checked={opts.fillers.enabled} onChange={(e) => set("fillers", { enabled: e.target.checked })} />
            <span>
              “음”, “어”, “으음” 같은 군말 찾기
              <span className="block text-xs text-muted">
                음성 인식으로 단어마다 시간을 얻어 찾습니다(이 컴퓨터에서 처리, 영상이 길면 몇 분 걸림, 처음 한 번은 모델 약 240MB 내려받음). 음성 인식은 군말을 빼고 적는 경우도 있어서
                <b> 못 찾는 군말이 있을 수 있고</b>, 평범한 단어를 군말로 잘못 볼 수도 있으니 목록을 꼭 확인하세요. 앞 30분까지만 찾습니다.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input className="mt-1" type="checkbox" checked={opts.fillers.loose} onChange={(e) => set("fillers", { loose: e.target.checked })} disabled={!opts.fillers.enabled} />
            <span>“그…”, “저…”, “뭐…”처럼 길게 끄는 말도 포함 <span className="text-xs text-muted">(진짜 단어일 수 있어 기본은 꺼져 있음)</span></span>
          </label>
        </fieldset>
      </div>

      {!hasSource(source) || !sourceReady(source) ? (
        <p className="rounded-md border border-line bg-card px-3 py-2 text-xs text-muted">위 “1. 편집할 영상”에서 영상을 고르고 권한 확인을 해 주세요.</p>
      ) : (
        <p className="rounded-md border border-line bg-card px-3 py-2 text-xs text-muted">영상: {sourceName(source)}</p>
      )}

      {error && <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary w-fit" onClick={analyze} disabled={!ready || (!opts.silence.enabled && !opts.fillers.enabled)}>
          {analyzing ? `${stage}…` : found ? "다시 분석하기" : "소리 분석하기"}
        </button>
        {needsReanalysis && (
          <span className="text-xs text-bad">
            {found!.noiseDb !== opts.silence.noiseDb ? "녹음 환경을 바꿨습니다. 다시 분석해야 반영됩니다." : "군말 찾기를 켰습니다. 다시 분석해야 반영됩니다."}
          </span>
        )}
      </div>

      {cut && stats && (
        <div className="flex flex-col gap-4 rounded-md border border-line p-3">
          <div className="text-sm">
            <p>
              원본 <b>{sec(stats.originalSec)}</b> → 결과 <b>{sec(stats.keptSec)}</b> <span className="text-good">({sec(stats.removedSec)} 줄어듦)</span>
            </p>
            <p className="text-xs text-muted">
              무음 {stats.silences}곳 · 군말 {stats.fillers}곳을 자름 · 남는 조각 {stats.pieces}개
              {cut.fillersAnalyzed && cut.wordsTruncated ? " · 군말은 앞 30분까지만 찾았습니다" : ""}
            </p>
          </div>

          {opts.fillers.enabled && cut.fillersAnalyzed && stats.fillers === 0 && (
            <p className="rounded-md border border-line bg-card px-3 py-2 text-xs text-muted">
              군말을 찾지 못했습니다. 말이 정말 깔끔했거나, 음성 인식이 군말을 빼고 적었을 수 있습니다.
            </p>
          )}
          {tooMany && (
            <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
              조각이 {stats.pieces}개로 너무 많아 영상으로 만들 수 없습니다(최대 {MAX_PIECES}개). “이 길이 이상 조용하면 자름”을 늘려 보세요. 컷 목록 내보내기는 그대로 됩니다.
            </p>
          )}

          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-muted">자를 곳 {removals.length}곳 · 체크를 끄면 그 부분은 살립니다</p>
              <div className="flex gap-2">
                <button className="btn" onClick={() => setOff(new Set())}>모두 자르기</button>
                <button className="btn" onClick={() => setOff(new Set(removals.map(key)))}>모두 살리기</button>
              </div>
            </div>
            <ul className="max-h-96 divide-y divide-line overflow-y-auto rounded-md border border-line">
              {removals.map((r) => (
                <li key={key(r)} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <input type="checkbox" checked={!off.has(key(r))} onChange={() => toggle(r)} aria-label={`${formatClock(r.start)} 자르기`} />
                  <span className="w-14 font-medium">{formatClock(r.start)}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${r.kind === "filler" ? "bg-accent/15 text-accent" : "bg-line text-muted"}`}>
                    {r.kind === "filler" ? `군말 “${r.text}”` : "무음"}
                  </span>
                  <span className="text-xs text-muted">{sec(r.end - r.start)}</span>
                  <span className="ml-auto">
                    <RangePreview file={file} sourcePath={sourcePath.trim()} start={Math.max(0, r.start - 1.5)} end={Math.min(cut.duration, r.end + 1.5)} basis={basis} label="▶ 앞뒤 3초 보기" />
                  </span>
                </li>
              ))}
              {removals.length === 0 && <li className="px-3 py-3 text-sm text-muted">자를 곳이 없습니다. 기준을 느슨하게 해 보세요.</li>}
            </ul>
          </div>

          <ExportMenu baseName={`${sourceName(source) || "영상"} 자동 컷`} clipName={sourceName(source)} cues={[]} cuts={kept} />

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-xs text-muted">결과 형식</span>
              <select className="input w-auto" value={layout} onChange={(e) => setLayout(e.target.value as typeof layout)}>
                <option value="auto">자동 ({horizontal ? "가로 1920×1080" : "세로 1080×1920"})</option>
                <option value="long">가로 1920×1080</option>
                <option value="short">세로 쇼츠 1080×1920 (3분 이하)</option>
              </select>
              <button className="btn-primary" onClick={render} disabled={!ready || !kept.length || tooMany || tooLongForShort}>
                {rendering ? (renderStage ? `${renderStage}…` : `만드는 중… ${Math.round(progress * 100)}%`) : "이 컷으로 영상 만들기"}
              </button>
            </div>
            <p className="text-xs text-muted">영상은 선택한 형식의 화면(원본 비율이 다르면 배경을 흐리게 채움)으로 만들어지며, 조각 사이에는 아주 짧은 소리 페이드가 들어가 이음매 잡음을 줄입니다. 원본 해상도 그대로 컷만 하려면 위의 컷 목록 EDL을 편집 프로그램에서 쓰세요.</p>
            {tooLongForShort && <p className="text-xs text-bad">결과가 3분을 넘어 쇼츠로는 만들 수 없습니다. 가로 형식을 고르세요.</p>}
            {rendering && (
              <div className="h-2 w-full max-w-md overflow-hidden rounded bg-line" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
                <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </div>

          {out && (
            <div className="flex flex-col items-start gap-2">
              <video className="max-h-[480px] max-w-full rounded-md border border-line" controls src={`/api/render/file?id=${out.id}`} />
              <p className="text-xs text-muted">{sec(out.durationSec)} · {(out.bytes / 1024 / 1024).toFixed(1)}MB</p>
              {renderNote && <p className="text-xs text-bad">{renderNote}</p>}
              <a className="btn-primary" href={`/api/render/file?id=${out.id}&download=1`}>mp4 다운로드</a>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
