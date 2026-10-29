"use client";

import { useMemo, useState } from "react";
import { formatClock } from "@/lib/editor/chapters";
import type { ReframeAnalysis } from "@/lib/editor/autoEditJobs";
import {
  assignTracks,
  cropFraction,
  cropHeightFraction,
  cropSizePx,
  cxAt,
  cyAt,
  inTarget,
  labelOf,
  samplesFromLooks,
  smoothTrack,
  suggestZoom,
  TARGETS,
  trackStats,
  type Keyframe,
  type Sample,
  type Target,
} from "@/lib/editor/reframe";
import { useCaptionStyle } from "./captionStyleContext";
import { api } from "../shared";
import { hasSource, sourceName, sourceReady, type SourceState } from "./source";
import ToolIntro from "./ToolIntro";

type AutoStatus = { status: "running" | "done" | "error"; stage: string; progress?: number; error?: string; reframe?: ReframeAnalysis };
type RenderStatus = { status: "running" | "done" | "error"; progress: number; stage?: string; note?: string; error?: string; result?: { durationSec: number; bytes: number } };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_SHORT_SEC = 180;
const SMOOTH_LABELS = ["빠르게 따라감", "", "보통", "", "느리고 차분하게"];
type ZoomChoice = "auto" | "1" | "1.5" | "2" | "3";
const LABEL_KO: Record<string, string> = {
  person: "사람", bird: "새", cat: "고양이", dog: "개", horse: "말", sheep: "양", cow: "소", elephant: "코끼리", bear: "곰", zebra: "얼룩말", giraffe: "기린",
  bicycle: "자전거", car: "자동차", motorcycle: "오토바이", airplane: "비행기", bus: "버스", train: "기차", truck: "트럭", boat: "배",
};

/**
 * Cuts a wide video to a vertical frame that follows a person (or an animal or a vehicle). What is in the picture is found once
 * (on this computer, nothing is sent anywhere); who to follow, how far to zoom and how the camera moves is worked out on the page,
 * so every control answers at once and the path can be seen.
 */
export default function AutoReframe({ source }: { source: SourceState }) {
  const { file, sourcePath, basis } = source;
  const { style } = useCaptionStyle();
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<ReframeAnalysis | null>(null);
  const [target, setTarget] = useState<Target>("person");
  const [zoomChoice, setZoomChoice] = useState<ZoomChoice>("auto");
  const [picks, setPicks] = useState<number[]>([]);
  const [smooth, setSmooth] = useState(3);
  const [fixed, setFixed] = useState(false);
  const [from, setFrom] = useState("0");
  const [to, setTo] = useState("60");
  const [rendering, setRendering] = useState(false);
  const [renderStage, setRenderStage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [renderNote, setRenderNote] = useState<string | null>(null);
  const [out, setOut] = useState<{ id: string; durationSec: number; bytes: number } | null>(null);

  const analyzing = stage !== null;
  const ready = sourceReady(source) && !analyzing && !rendering;

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
    setPicks([]);
    setStage("올리는 중");
    try {
      const res = await fetch("/api/autoreframe", { method: "POST", body: body({}) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `분석 실패 (${res.status})`);
      for (;;) {
        await wait(1000);
        const st = await api<AutoStatus>(`/api/autoedit/status?id=${json.id}`);
        setStage(st.stage);
        if (st.status === "error") throw new Error(st.error ?? "분석에 실패했습니다.");
        if (st.status === "done" && st.reframe) {
          setFound(st.reframe);
          setFrom("0");
          setTo(String(Math.min(Math.floor(st.reframe.duration), 60)));
          break;
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStage(null);
    }
  };

  // Everything below is recomputed on the page whenever a control changes; nothing talks to the server.
  const tracked = useMemo(() => (found ? assignTracks(found.looks) : []), [found]);
  const zoom = useMemo(() => {
    if (!found) return 1;
    return zoomChoice === "auto" ? suggestZoom(found.looks, target) : Number(zoomChoice);
  }, [found, zoomChoice, target]);
  const cropFrac = found ? cropFraction(found.width, found.height, zoom) : 1;
  const cropHFrac = cropHeightFraction(zoom);
  const samples: Sample[] = useMemo(() => (found ? samplesFromLooks(tracked, { target, cropFrac, picks }) : []), [found, tracked, target, cropFrac, picks]);
  const keys: Keyframe[] = useMemo(
    () => (found ? smoothTrack(samples, { cropFrac, cropHFrac, duration: found.duration, smooth, fixed }) : []),
    [found, samples, cropFrac, cropHFrac, smooth, fixed],
  );
  const stats = useMemo(() => trackStats(samples), [samples]);

  // The things that can be followed, longest-seen first, for choosing by name instead of by clicking a picture.
  const candidates = useMemo(() => {
    const m = new Map<number, { id: number; label: string; first: number; last: number; looks: number }>();
    for (const look of tracked)
      for (const b of look.boxes) {
        if (!inTarget(b, target)) continue;
        const c = m.get(b.id);
        if (c) {
          c.last = look.t;
          c.looks++;
        } else m.set(b.id, { id: b.id, label: labelOf(b), first: look.t, last: look.t, looks: 1 });
      }
    // a detection seen in a single look is usually a flicker; leave it out of the list (its box can still be clicked in a picture)
    const all = [...m.values()].sort((a, b) => b.looks - a.looks);
    const steady = all.filter((c) => c.looks >= 2);
    return (steady.length ? steady : all).slice(0, 12);
  }, [tracked, target]);

  const togglePick = (id: number) => setPicks((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const changeTarget = (t: Target) => {
    setTarget(t);
    setPicks([]);
  };

  const start = Math.max(0, Number(from) || 0);
  const end = Math.min(found?.duration ?? 0, Number(to) || 0);
  const span = end - start;
  const spanOk = !!found && span >= 1 && span <= MAX_SHORT_SEC;
  const narrow = !!found && found.width <= found.height;
  const win = found ? cropSizePx(found.width, found.height, zoom) : null;
  const what = TARGETS.find((x) => x.id === target)?.label ?? "대상";

  const render = async () => {
    if (!found || !spanOk) return;
    setError(null);
    setOut(null);
    setProgress(0);
    setRenderStage(null);
    setRenderNote(null);
    setRendering(true);
    try {
      // only the part that is used, with a second to spare: a whole-video path would be very long
      const part = keys.filter((k) => k.t >= start - 1 && k.t <= end + 1);
      const res = await fetch("/api/render", {
        method: "POST",
        body: body({ layout: "short", fit: "blur", trimStart: start, trimEnd: end, captions: [], style, reframe: { keyframes: part, zoom } }),
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
      <ToolIntro
        icon="frame"
        title="가로 → 세로 자동 프레임"
        summary="가로 영상을 세로(9:16)로 자를 때 사람·동물·탈것이 화면 밖으로 잘리지 않게 자르는 위치를 자동으로 옮깁니다."
        steps={["‘찾기 시작’을 누릅니다", "따라갈 대상·확대·카메라 움직임을 조절합니다", "구간을 정하고 ‘세로 쇼츠로 만들기’를 누릅니다"]}
        uses="local"
      >
        가로 영상을 세로(9:16)로 자를 때 사람(또는 동물·탈것)이 화면 밖으로 잘리지 않게, 자르는 위치를 자동으로 옮깁니다. 찾기는 이 컴퓨터에서만 하고(영상이 밖으로 나가지 않음),
          처음 한 번은 인식 모델(약 9MB)을 내려받습니다. 누구를 따라갈지, 얼마나 확대할지, 카메라가 얼마나 빨리 움직일지는 아래에서 눈으로 보고 조절할 수 있습니다.
      </ToolIntro>

      {!hasSource(source) || !sourceReady(source) ? (
        <p className="rounded-md border border-line bg-card px-3 py-2 text-xs text-muted">위 “1. 편집할 영상”에서 영상을 고르고 권한 확인을 해 주세요.</p>
      ) : (
        <p className="rounded-md border border-line bg-card px-3 py-2 text-xs text-muted">영상: {sourceName(source)}</p>
      )}

      {error && <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary w-fit" onClick={analyze} disabled={!ready}>
          {analyzing ? `${stage}…` : found ? "다시 찾기" : "찾기 시작"}
        </button>
        <span className="text-xs text-muted">영상 1분당 대략 1분 안팎(컴퓨터에 따라 다름). 0.5초마다 한 장씩 봅니다.</span>
      </div>

      {found && (
        <div className="flex flex-col gap-4 rounded-md border border-line p-3">
          {narrow && <p className="text-sm text-bad">이미 세로 영상이라 자를 필요가 없습니다.</p>}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="field text-xs">무엇을 따라갈까요
              <select className="input" value={target} onChange={(e) => changeTarget(e.target.value as Target)}>
                {TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            <label className="field text-xs">확대
              <select className="input" value={zoomChoice} onChange={(e) => setZoomChoice(e.target.value as ZoomChoice)}>
                <option value="auto">자동 (대상이 작으면 키움, 현재 {suggestZoom(found.looks, target)}배)</option>
                <option value="1">확대 안 함 (전체 높이)</option>
                <option value="1.5">1.5배</option>
                <option value="2">2배</option>
                <option value="3">3배</option>
              </select>
              {win && zoom > 1 && (
                <span className="text-muted">원본에서 {win.w}×{win.h}픽셀만 잘라 1080×1920으로 키웁니다. 확대할수록 화면이 흐려집니다.</span>
              )}
            </label>
            <label className="field text-xs">
              카메라 움직임: <b>{SMOOTH_LABELS[smooth - 1] || `${smooth}단계`}</b> ({smooth}/5)
              <input type="range" min={1} max={5} step={1} value={smooth} onChange={(e) => setSmooth(Number(e.target.value))} disabled={fixed} />
              <span className="text-muted">낮을수록 바짝 따라가고, 높을수록 천천히 부드럽게 움직입니다.</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input className="mt-1" type="checkbox" checked={fixed} onChange={(e) => setFixed(e.target.checked)} />
              <span>
                따라가지 않고 가운데 고정
                <span className="block text-xs text-muted">찾기가 잘 안 맞는 영상에서 쓰세요.</span>
              </span>
            </label>
          </div>

          <p className="text-sm">
            {found.looks.length}장을 보고 {what}을(를) <b>{stats.pct}%</b>에서 찾았습니다{picks.length ? " (지정한 것만 센 값)" : ""}.
            {stats.pct < 40 && <span className="text-bad"> 찾은 곳이 적어 대부분 가운데 근처로 잘립니다. 작거나 가려진 영상이면 “대상”을 바꿔 보거나 가운데 고정을 쓰세요.</span>}
          </p>

          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-muted">
                여럿이면 따라갈 것을 고르세요 (사진 속 상자를 누르거나 아래 목록에서 체크). 고르지 않으면 모두가 한 화면에 들어올 때는 가운데, 안 들어올 때는 가장 크게 보이는 것을 따라갑니다.
              </p>
              {picks.length > 0 && <button className="btn" onClick={() => setPicks([])}>지정 해제</button>}
            </div>
            {candidates.length === 0 ? (
              <p className="rounded-md border border-line bg-card px-3 py-2 text-xs text-muted">이 영상에서 “{what}”을(를) 찾지 못했습니다. 위에서 다른 대상을 골라 보세요.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <label className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${picks.includes(c.id) ? "border-accent bg-accent/10" : "border-line"}`}>
                      <input type="checkbox" checked={picks.includes(c.id)} onChange={() => togglePick(c.id)} />
                      #{c.id} {LABEL_KO[c.label] ?? c.label} · {formatClock(c.first)}–{formatClock(c.last)} ({c.looks}장)
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {picks.length > 0 && <p className="mt-1 text-xs text-muted">지정한 것이 화면에 없는 동안에는 카메라가 마지막 자리를 잠시 지킨 뒤 가운데로 천천히 돌아옵니다. 같은 사람이 다시 나타나면 번호가 다를 수 있으니 그 사람도 체크하세요.</p>}
          </div>

          <PathGraph duration={found.duration} cropFrac={cropFrac} showY={zoom > 1} keys={keys} samples={samples} from={start} to={end} />

          <div>
            <p className="mb-1 text-xs font-semibold text-muted">잘리는 자리 미리보기 (밝은 부분이 결과 화면)</p>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {found.thumbs.map((th) => {
                const cx = cxAt(keys, th.t);
                const cy = cyAt(keys, th.t);
                const look = tracked.reduce((best, l) => (Math.abs(l.t - th.t) < Math.abs(best.t - th.t) ? l : best), tracked[0]);
                return (
                  <li key={th.t} className="flex flex-col gap-1">
                    <div className="relative overflow-hidden rounded border border-line">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={th.dataUrl} alt={`${formatClock(th.t)} 화면`} className="block w-full" />
                      <div
                        className="pointer-events-none absolute border-2 border-accent"
                        style={{
                          left: `${(cx - cropFrac / 2) * 100}%`,
                          width: `${cropFrac * 100}%`,
                          top: `${(cy - cropHFrac / 2) * 100}%`,
                          height: `${cropHFrac * 100}%`,
                          boxShadow: "0 0 0 999px rgba(0,0,0,0.55)",
                        }}
                      />
                      {look?.boxes.filter((b) => inTarget(b, target)).map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => togglePick(b.id)}
                          aria-label={`#${b.id} ${LABEL_KO[labelOf(b)] ?? labelOf(b)} ${picks.includes(b.id) ? "지정 해제" : "따라가기"}`}
                          className={`absolute border ${picks.includes(b.id) ? "border-2 border-good bg-good/20" : "border-white/70 hover:bg-white/20"}`}
                          style={{ left: `${b.x0 * 100}%`, top: `${b.y0 * 100}%`, width: `${(b.x1 - b.x0) * 100}%`, height: `${(b.y1 - b.y0) * 100}%` }}
                        >
                          <span className="absolute left-0 top-0 bg-black/70 px-1 text-[10px] leading-4 text-white">#{b.id}</span>
                        </button>
                      ))}
                    </div>
                    <span className="text-xs text-muted">{formatClock(th.t)}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end gap-3 text-sm">
              <label className="field text-xs">시작(초)
                <input className="input w-24" inputMode="decimal" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="field text-xs">끝(초)
                <input className="input w-24" inputMode="decimal" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
              <span className="pb-2 text-xs text-muted">전체 {formatClock(found.duration)} · 선택 {Math.round(Math.max(0, span))}초 (쇼츠는 {MAX_SHORT_SEC}초 이하)</span>
              <button className="btn-primary" onClick={render} disabled={!ready || !spanOk || narrow}>
                {rendering ? (renderStage ? `${renderStage}…` : `만드는 중… ${Math.round(progress * 100)}%`) : "세로 쇼츠로 만들기"}
              </button>
            </div>
            {!spanOk && <p className="text-xs text-bad">1초 이상 {MAX_SHORT_SEC}초 이하로 골라 주세요.</p>}
            {rendering && (
              <div className="h-2 w-full max-w-md overflow-hidden rounded bg-line" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
                <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </div>

          {out && (
            <div className="flex flex-col items-start gap-2">
              <video className="max-h-[480px] max-w-full rounded-md border border-line" controls src={`/api/render/file?id=${out.id}`} />
              {renderNote && <p className="text-xs text-bad">{renderNote}</p>}
              <p className="text-xs text-muted">{Math.round(out.durationSec)}초 · {(out.bytes / 1024 / 1024).toFixed(1)}MB</p>
              <a className="btn-primary" href={`/api/render/file?id=${out.id}&download=1`}>mp4 다운로드</a>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** The camera over time: where the crop window sits across the picture (and, zoomed in, up and down), with each look's find as a dot and the chosen span shaded. */
function PathGraph({ duration, cropFrac, showY, keys, samples, from, to }: { duration: number; cropFrac: number; showY: boolean; keys: Keyframe[]; samples: Sample[]; from: number; to: number }) {
  const W = 600;
  const H = 90;
  const x = (t: number) => (t / Math.max(duration, 0.1)) * W;
  const y = (v: number) => v * H;
  // thin the line to a few hundred points so a long video stays light
  const step = Math.max(1, Math.ceil(keys.length / 400));
  const thin = keys.filter((_, i) => i % step === 0);
  const line = thin.map((k) => `${x(k.t).toFixed(1)},${y(k.cx).toFixed(1)}`).join(" ");
  const lineY = thin.map((k) => `${x(k.t).toFixed(1)},${y(k.cy ?? 0.5).toFixed(1)}`).join(" ");
  const dots = samples.filter((s) => s.cx !== null);
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-muted">카메라 위치 (위 = 화면 왼쪽, 아래 = 화면 오른쪽 · 점은 찾은 곳, 파란 선은 실제 움직임{showY ? ", 점선은 위아래(위 = 화면 위쪽)" : ""})</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded border border-line bg-card" role="img" aria-label="시간에 따른 카메라 위치">
        <rect x={x(from)} y={0} width={Math.max(0, x(to) - x(from))} height={H} fill="currentColor" opacity={0.08} />
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="currentColor" opacity={0.15} strokeDasharray="4 4" />
        {dots.filter((_, i) => i % Math.max(1, Math.ceil(dots.length / 300)) === 0).map((s) => (
          <circle key={s.t} cx={x(s.t)} cy={y(s.cx as number)} r={1.6} fill="currentColor" opacity={0.35} />
        ))}
        <polyline points={line} fill="none" stroke="var(--accent, #6366f1)" strokeWidth={2} />
        {showY && <polyline points={lineY} fill="none" stroke="var(--accent, #6366f1)" strokeWidth={1.5} strokeDasharray="5 3" opacity={0.7} />}
      </svg>
      <p className="mt-1 text-xs text-muted">결과 화면 너비는 원본의 {Math.round(cropFrac * 100)}%입니다. 음영은 만들 구간입니다.</p>
    </div>
  );
}
