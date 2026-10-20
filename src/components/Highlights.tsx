"use client";

import { useEffect, useRef, useState } from "react";
import type { Highlight } from "@/lib/highlights";
import type { Idea } from "@/lib/recommend";
import { captionHasBadTimes, editedCaptions, toCaps, type Cap } from "@/lib/captionEdit";
import type { EditPlan } from "@/lib/autoEdit";
import PlanPanel from "./PlanPanel";
import { api, BASIS, type Basis } from "./shared";

type AutoStatus = {
  status: "running" | "done" | "error";
  stage: string;
  error?: string;
  highlights?: Highlight[];
  plan?: EditPlan;
  longformNote?: string;
  lengthRange?: { min: number; max: number } | null;
  duration?: number;
};

const FIT_LABEL = { within: "내 채널 잘된 길이", shorter: "내 채널 잘된 쇼츠보다 짧음", longer: "내 채널 잘된 쇼츠보다 김" } as const;
type RenderStatus = { status: "running" | "done" | "error"; progress: number; error?: string; result?: { durationSec: number; bytes: number } };
type Made = { state: "running" | "done" | "error"; progress: number; id?: string; durationSec?: number; bytes?: number; error?: string };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
};

/** D. Pick the stretches of a long video that would work as Shorts, then turn the chosen ones into Shorts. */
export default function Highlights({ idea }: { idea: Idea }) {
  const [file, setFile] = useState<File | null>(null);
  const [sourcePath, setSourcePath] = useState("");
  const [topic, setTopic] = useState(idea.title);
  const [count, setCount] = useState(5);
  const [speech, setSpeech] = useState(true);
  const [longform, setLongform] = useState(false);
  const [basis, setBasis] = useState<Basis | "">("");
  const [confirmed, setConfirmed] = useState(false);

  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<Highlight[] | null>(null);
  const [range, setRange] = useState<{ min: number; max: number } | null>(null);
  const [longPlan, setLongPlan] = useState<EditPlan | null>(null);
  const [longNote, setLongNote] = useState<string | null>(null);
  const [hooks, setHooks] = useState<string[]>([]);
  const [caps, setCaps] = useState<Cap[][]>([]);
  const [made, setMade] = useState<Record<number, Made>>({});

  const finding = stage !== null;
  const hasSource = !!file || !!sourcePath.trim();
  const ready = hasSource && confirmed && !!basis && !finding;
  const busyMaking = Object.values(made).some((m) => m.state === "running");

  const body = (options: object) => {
    const fd = new FormData();
    if (file) fd.append("file", file);
    fd.append("options", JSON.stringify({ ...options, sourcePath: !file && sourcePath.trim() ? sourcePath.trim() : undefined, rights: { confirmed: true, basis } }));
    return fd;
  };

  const find = async () => {
    if (!basis) return;
    setError(null);
    setFound(null);
    setLongPlan(null);
    setLongNote(null);
    setMade({});
    setStage("올리는 중");
    try {
      const res = await fetch("/api/highlights", { method: "POST", body: body({ topic, count, speech, longform }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `분석 실패 (${res.status})`);
      for (;;) {
        await wait(2000);
        const st = await api<AutoStatus>(`/api/autoedit/status?id=${json.id}`);
        setStage(st.stage);
        if (st.status === "error") throw new Error(st.error ?? "분석에 실패했습니다.");
        if (st.status === "done" && st.highlights) {
          setFound(st.highlights);
          setRange(st.lengthRange ?? null);
          setLongPlan(st.plan ?? null);
          setLongNote(st.longformNote ?? null);
          setHooks(st.highlights.map((h) => h.hook));
          setCaps(st.highlights.map((h) => toCaps(h.captions)));
          break;
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStage(null);
    }
  };

  const patch = (i: number, m: Partial<Made>) =>
    setMade((cur) => ({ ...cur, [i]: { ...({ state: "running", progress: 0 } as Made), ...cur[i], ...m } }));

  /** Renders one candidate as a Short. Resolves when finished (or failed); the error is shown on the card. */
  const make = async (i: number) => {
    const h = found?.[i];
    if (!h || !basis) return;
    patch(i, { state: "running", progress: 0, error: undefined, id: undefined });
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        body: body({
          layout: "short",
          fit: "blur",
          segments: [{ start: h.start, end: h.end }],
          hook: hooks[i]?.trim() ? { text: hooks[i], seconds: 2.5 } : undefined,
          captions: editedCaptions(caps[i] ?? []),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `렌더링 실패 (${res.status})`);
      for (;;) {
        await wait(1000);
        const st = await api<RenderStatus>(`/api/render/status?id=${json.id}`);
        patch(i, { progress: st.progress });
        if (st.status === "error") throw new Error(st.error ?? "렌더링에 실패했습니다.");
        if (st.status === "done" && st.result) {
          patch(i, { state: "done", progress: 1, id: json.id, durationSec: st.result.durationSec, bytes: st.result.bytes });
          // Remember which candidate this was, so it can later be linked to the uploaded video and its AI score checked.
          fetch("/api/clips", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: json.id,
              sourceName: file?.name ?? sourcePath.trim().split(/[\\/]/).pop() ?? "",
              aiScore: h.score,
              reason: h.reason,
              title: h.title,
              hook: hooks[i] ?? h.hook,
              start: h.start,
              end: h.end,
              lengthFit: h.lengthFit ?? null,
            }),
          }).catch(() => {});
          return;
        }
      }
    } catch (e) {
      patch(i, { state: "error", error: (e as Error).message });
    }
  };

  const makeAll = async () => {
    // One at a time: each render uses all CPU cores already.
    for (let i = 0; i < (found?.length ?? 0); i++) if (made[i]?.state !== "done") await make(i);
  };

  const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => {});

  return (
    <section className="card flex flex-col gap-4">
      <div>
        <h2 className="font-semibold">D. 긴 영상에서 쇼츠 뽑기</h2>
        <p className="text-xs text-muted">
          길이가 긴 영상 하나를 넣으면 AI가 쇼츠로 잘라 올리기 좋은 구간을 점수와 이유까지 붙여 후보로 뽑습니다. 마음에 드는 후보를 고르면 훅 자막과(음성 인식을
          켰다면) 대사 자막까지 붙여 쇼츠로 만들어 줍니다. 긴 영상은 파일 경로로 넣는 것이 편합니다(업로드는 600MB까지).
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">영상 파일 올리기 (mp4, mov, webm, mkv · 최대 600MB)
          <input className="input" type="file" accept="video/*,.mkv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="field">또는 이 컴퓨터의 파일 경로 (긴 영상 추천)
          <input className="input" placeholder="D:\영상\긴영상.mp4" value={sourcePath} disabled={!!file} onChange={(e) => setSourcePath(e.target.value)} />
        </label>
        <label className="field">주제 / 채널 성격 (AI에게 전달)
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} />
        </label>
        <label className="field">뽑을 후보 수
          <select className="input" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[3, 4, 5, 6].map((n) => <option key={n} value={n}>최대 {n}개</option>)}
          </select>
        </label>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input className="mt-1" type="checkbox" checked={speech} onChange={(e) => setSpeech(e.target.checked)} />
        <span>
          <b>음성 인식 사용</b> (추천: 말이 있는 영상이면 구간을 더 잘 고르고 대사 자막이 자동으로 붙습니다 · 이 컴퓨터에서 처리 · 영상이 길면 몇 분~수십 분 걸림, 앞
          30분까지만 인식)
          <span className="block text-xs text-muted">
            처음 한 번은 모델(약 240MB)을 내려받습니다. 장면 이미지와 인식된 대사 텍스트가 Anthropic API로 전송되고 영상 파일과 소리는 밖으로 나가지 않습니다.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input className="mt-1" type="checkbox" checked={longform} onChange={(e) => setLongform(e.target.checked)} />
        <span>
          <b>롱폼 요약 구성도 만들기</b> (쇼츠와 별개로, 같은 영상을 챕터가 있는 가로 롱폼 한 편으로 줄이는 계획 · AI를 한 번 더 호출 · 원본의 절반 안팎, 1~15분)
        </span>
      </label>

      <fieldset className="flex flex-col gap-2 rounded-md border border-line p-3">
        <legend className="px-1 text-xs font-semibold text-muted">영상 사용 권한 확인 (필수)</legend>
        <select className="input" value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
          <option value="">이 영상의 권리 관계를 선택하세요</option>
          {BASIS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
        <label className="flex items-start gap-2 text-sm">
          <input className="mt-1" type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>
            이 영상은 제가 직접 촬영했거나, 저작권자의 사용 허락(라이선스·협의)을 받은 영상입니다. 방송·타사 영상을 권리 확인 없이 쓰는 경우의 책임은 제게
            있음을 이해합니다.
          </span>
        </label>
      </fieldset>

      {error && <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <button className="btn-primary w-fit" onClick={find} disabled={!ready || busyMaking}>
        {finding ? `${stage}…` : found ? "다시 찾기" : "쇼츠 구간 찾기"}
      </button>

      {found && found.length === 0 && <p className="text-sm text-muted">쇼츠로 쓸 만한 구간을 찾지 못했습니다. 영상이 너무 짧거나 변화가 거의 없을 수 있습니다.</p>}

      {found && found.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">
              점수 순 · 후보 {found.length}개 · 훅 자막은 고쳐도 됩니다
              {range ? ` · 내 채널에서 잘된 쇼츠는 ${range.min}~${range.max}초` : " · 내 채널 성과 자료가 부족하거나 불러오지 못해 길이는 참고하지 않았습니다"}
            </p>
            <button className="btn" onClick={makeAll} disabled={busyMaking || finding}>추천 쇼츠 모두 만들기</button>
          </div>
          <ul className="flex flex-col gap-3">
            {found.map((h, i) => {
              const m = made[i];
              return (
                <li key={i} className="flex flex-col gap-2 rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="rounded bg-accent/15 px-1.5 py-0.5 text-xs font-semibold text-accent">{h.score}점</span>
                    <span className="font-medium">{clock(h.start)}–{clock(h.end)}</span>
                    <span className="text-xs text-muted">{Math.round(h.end - h.start)}초{h.captions.length ? ` · 대사 자막 ${h.captions.length}줄` : ""}</span>
                    {h.lengthFit && (
                      <span className={`rounded px-1.5 py-0.5 text-xs ${h.lengthFit === "within" ? "bg-good/15 text-good" : "bg-line text-muted"}`}>
                        {FIT_LABEL[h.lengthFit]}
                      </span>
                    )}
                  </div>
                  <p className="text-sm">{h.reason}</p>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-xs text-muted">제목 후보</span>
                    <span>{h.title}</span>
                    <button className="text-xs text-accent hover:underline" onClick={() => copy(h.title)}>복사</button>
                  </div>
                  <Preview
                    key={`${h.start}-${h.end}`}
                    file={file}
                    sourcePath={sourcePath.trim()}
                    start={h.start}
                    end={h.end}
                    basis={basis}
                  />
                  <label className="field">훅 자막
                    <input className="input" value={hooks[i] ?? ""} onChange={(e) => setHooks(hooks.map((x, j) => (j === i ? e.target.value : x)))} />
                  </label>
                  <details className="rounded-md border border-line px-3 py-2">
                    <summary className="cursor-pointer text-sm">
                      자막 {editedCaptions(caps[i] ?? []).length}줄 {h.captions.length ? "(음성 인식 결과 · 틀린 글자를 고치세요)" : "(없음 · 직접 추가할 수 있습니다)"}
                    </summary>
                    <CaptionEditor
                      caps={caps[i] ?? []}
                      max={Math.round((h.end - h.start) * 10) / 10}
                      onChange={(next) => setCaps(caps.map((x, j) => (j === i ? next : x)))}
                      onReset={() => setCaps(caps.map((x, j) => (j === i ? toCaps(h.captions) : x)))}
                    />
                  </details>
                  <div className="flex flex-col gap-2">
                    <button className="btn-primary w-fit" onClick={() => make(i)} disabled={m?.state === "running" || busyMaking}>
                      {m?.state === "running" ? `만드는 중… ${Math.round(m.progress * 100)}%` : m?.state === "done" ? "다시 만들기" : "이 구간으로 쇼츠 만들기"}
                    </button>
                    {m?.state === "running" && (
                      <div className="h-2 w-full max-w-md overflow-hidden rounded bg-line" role="progressbar" aria-valuenow={Math.round(m.progress * 100)}>
                        <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(m.progress * 100)}%` }} />
                      </div>
                    )}
                    {m?.state === "error" && <p className="text-sm text-bad">{m.error}</p>}
                  </div>
                  {m?.state === "done" && m.id && (
                    <div className="flex flex-col items-start gap-2">
                      <video className="max-h-[480px] max-w-full rounded-md border border-line" controls src={`/api/render/file?id=${m.id}`} />
                      <p className="text-xs text-muted">{m.durationSec}초 · {((m.bytes ?? 0) / 1024 / 1024).toFixed(1)}MB</p>
                      <a className="btn-primary" href={`/api/render/file?id=${m.id}&download=1`}>mp4 다운로드</a>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {longNote && <p className="rounded-md border border-line bg-card px-3 py-2 text-xs text-muted">{longNote}</p>}
      {longPlan && (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">롱폼 요약 구성 (1920×1080 가로)</h3>
          <PlanPanel plan={longPlan} layout="long" body={body} disabled={finding} />
        </div>
      )}
    </section>
  );
}

function CaptionEditor({ caps, max, onChange, onReset }: { caps: Cap[]; max: number; onChange: (c: Cap[]) => void; onReset: () => void }) {
  const set = (i: number, patch: Partial<Cap>) => onChange(caps.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const bad = captionHasBadTimes;
  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="text-xs text-muted">시간은 이 쇼츠가 시작하는 지점을 0초로 한 초 단위입니다(전체 {max}초). 글자가 비어 있거나 시간이 맞지 않는 줄은 영상에 넣지 않습니다.</p>
      <ul className="space-y-2">
        {caps.map((c, i) => (
          <li key={i} className="grid grid-cols-[4rem_4rem_1fr_auto] items-center gap-2">
            <input className={`input ${bad(c) ? "border-bad" : ""}`} inputMode="decimal" placeholder="시작" value={c.start} onChange={(e) => set(i, { start: e.target.value })} />
            <input className={`input ${bad(c) ? "border-bad" : ""}`} inputMode="decimal" placeholder="끝" value={c.end} onChange={(e) => set(i, { end: e.target.value })} />
            <input className="input" placeholder="자막" value={c.text} onChange={(e) => set(i, { text: e.target.value })} />
            <button className="text-xs text-muted hover:text-bad" onClick={() => onChange(caps.filter((_, j) => j !== i))}>삭제</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button className="btn" onClick={() => onChange([...caps, { start: caps.length ? caps[caps.length - 1].end : "0", end: "", text: "" }])}>+ 자막 추가</button>
        <button className="btn" onClick={onReset}>처음 상태로</button>
      </div>
    </div>
  );
}

/** Watch the stretch before spending a render on it. An uploaded file plays in the browser; a path gets a small copy made by the server. */
function Preview({ file, sourcePath, start, end, basis }: { file: File | null; sourcePath: string; start: number; end: number; basis: Basis | "" }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);

  // The object URL made for an uploaded file, so it can be released when the card closes or goes away.
  const objectUrl = useRef<string | null>(null);
  const release = () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  };
  useEffect(() => release, []);

  const show = async () => {
    setOpen(true);
    setError(null);
    if (file) {
      release();
      objectUrl.current = URL.createObjectURL(file);
      setSrc(`${objectUrl.current}#t=${start},${end}`);
      return;
    }
    if (!basis) {
      setError("미리 보려면 아래에서 영상의 권리 관계를 선택하고 권한 확인에 체크해 주세요.");
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath, start, end, rights: { confirmed: true, basis } }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `미리 보기 실패 (${res.status})`);
      setSrc(`/api/preview/file?id=${json.id}`);
    } catch (e) {
      setError((e as Error).message);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      {!open && (
        <button className="btn" onClick={show} disabled={busy}>구간 미리 보기</button>
      )}
      {busy && <p className="text-xs text-muted">미리 보기를 만드는 중…</p>}
      {open && src && (
        <>
          <video
            className="max-h-[300px] max-w-full rounded-md border border-line"
            controls
            src={src}
            onTimeUpdate={(e) => {
              // an uploaded file plays the whole source; stop where the candidate ends
              if (file && e.currentTarget.currentTime >= end) e.currentTarget.pause();
            }}
            onError={() => setError(file ? "브라우저가 이 파일 형식을 재생하지 못합니다. 파일 경로로 넣으면 미리 보기를 만들 수 있습니다." : "미리 보기를 재생하지 못했습니다.")}
          />
          <p className="text-xs text-muted">원본 화면을 낮은 화질로 보여 줍니다. 훅·자막·세로 프레임은 만들기를 누른 뒤 결과에서 확인하세요.</p>
          <button className="text-xs text-muted hover:underline" onClick={() => { release(); setOpen(false); setSrc(null); }}>닫기</button>
        </>
      )}
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
