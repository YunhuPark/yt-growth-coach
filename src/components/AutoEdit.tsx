"use client";

import { useState } from "react";
import type { EditPlan } from "@/lib/autoEdit";
import type { LongPack, Pack } from "@/lib/package";
import type { Idea } from "@/lib/recommend";
import { api, BASIS, isLongPack, type Basis } from "./shared";

type AutoStatus = { status: "running" | "done" | "error"; stage: string; error?: string; plan?: EditPlan; duration?: number };
type RenderStatus = {
  status: "running" | "done" | "error";
  progress: number;
  error?: string;
  result?: { durationSec: number; bytes: number; layout: "short" | "long" };
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** C. The AI looks at the footage, proposes cuts, captions and titles; the creator reviews, then renders. */
export default function AutoEdit({ idea, pack }: { idea: Idea; pack: Pack | LongPack }) {
  const long = isLongPack(pack);
  const [file, setFile] = useState<File | null>(null);
  const [sourcePath, setSourcePath] = useState("");
  const [targetSec, setTargetSec] = useState(long ? "480" : "40");
  const [topic, setTopic] = useState(`${idea.title}`);
  const [basis, setBasis] = useState<Basis | "">("");
  const [confirmed, setConfirmed] = useState(false);

  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<EditPlan | null>(null);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [out, setOut] = useState<{ id: string; durationSec: number; bytes: number } | null>(null);

  const analyzing = stage !== null;
  const hasSource = !!file || !!sourcePath.trim();
  const ready = hasSource && confirmed && !!basis && !analyzing && !rendering;

  const body = (options: object) => {
    const fd = new FormData();
    if (file) fd.append("file", file);
    fd.append("options", JSON.stringify({ ...options, sourcePath: !file && sourcePath.trim() ? sourcePath.trim() : undefined, rights: { confirmed: true, basis } }));
    return fd;
  };

  const analyze = async () => {
    if (!basis) return;
    setError(null);
    setPlan(null);
    setOut(null);
    setStage("올리는 중");
    try {
      const res = await fetch("/api/autoedit", {
        method: "POST",
        body: body({ layout: long ? "long" : "short", topic, targetSec: Number(targetSec) || (long ? 480 : 40) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `분석 실패 (${res.status})`);
      for (;;) {
        await wait(1500);
        const st = await api<AutoStatus>(`/api/autoedit/status?id=${json.id}`);
        setStage(st.stage);
        if (st.status === "error") throw new Error(st.error ?? "분석에 실패했습니다.");
        if (st.status === "done" && st.plan) {
          setPlan(st.plan);
          break;
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStage(null);
    }
  };

  const render = async () => {
    if (!plan || !basis) return;
    setError(null);
    setOut(null);
    setProgress(0);
    setRendering(true);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        body: body({
          layout: long ? "long" : "short",
          fit: "blur",
          segments: plan.segments.map(({ start, end }) => ({ start, end })),
          hook: plan.hook ?? undefined,
          captions: plan.captions,
          ending: plan.ending ?? undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `렌더링 실패 (${res.status})`);
      for (;;) {
        await wait(1000);
        const st = await api<RenderStatus>(`/api/render/status?id=${json.id}`);
        setProgress(st.progress);
        if (st.status === "error") throw new Error(st.error ?? "렌더링에 실패했습니다.");
        if (st.status === "done" && st.result) {
          setOut({ id: json.id, ...st.result });
          break;
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRendering(false);
    }
  };

  const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => {});

  return (
    <section className="card flex flex-col gap-4">
      <div>
        <h2 className="font-semibold">C. AI 자동 편집 · 컷 · 자막 · 제목</h2>
        <p className="text-xs text-muted">
          영상 파일을 AI가 훑어보고(대표 장면, 장면 전환, 무음 구간, 소리 크기) 버릴 부분을 자르고, 훅·구간 자막과 제목 후보 3개를 제안합니다. 먼저 계획을
          보여 주고, 확인한 뒤에 영상을 만듭니다. <b>대사는 알아듣지 못합니다</b> — 자막은 보이는 장면과 분위기 기준의 문구이니, 말소리 자막이 필요하면 직접
          고쳐 주세요. 이미지 몇 장이 분석을 위해 Anthropic API로 전송됩니다.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">영상 파일 올리기 (mp4, mov, webm, mkv · 최대 600MB)
          <input className="input" type="file" accept="video/*,.mkv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="field">또는 이 컴퓨터의 파일 경로 (큰 파일용)
          <input className="input" placeholder="D:\영상\원본.mp4" value={sourcePath} disabled={!!file} onChange={(e) => setSourcePath(e.target.value)} />
        </label>
        <label className="field">주제 / 만들려는 영상 (AI에게 전달)
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} />
        </label>
        <label className="field">목표 길이(초)
          <input className="input" inputMode="decimal" value={targetSec} onChange={(e) => setTargetSec(e.target.value)} />
        </label>
      </div>

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

      <button className="btn-primary w-fit" onClick={analyze} disabled={!ready}>
        {analyzing ? `${stage}…` : plan ? "계획 다시 만들기" : "AI 편집 계획 만들기"}
      </button>

      {plan && (
        <div className="flex flex-col gap-4 rounded-md border border-line p-3">
          <p className="text-sm">{plan.summary}</p>
          {plan.warnings.map((w) => (
            <p key={w} className="rounded-md border border-line bg-card px-3 py-2 text-xs text-muted">{w}</p>
          ))}

          <div>
            <p className="mb-1 text-xs font-semibold text-muted">남길 구간 · 결과 {plan.outputSec}초</p>
            <ul className="space-y-0.5 text-sm">
              {plan.segments.map((s, i) => (
                <li key={i}>
                  <span className="font-medium">{clock(s.start)}–{clock(s.end)}</span>{" "}
                  <span className="text-xs text-muted">({(s.end - s.start).toFixed(1)}초){s.reason ? ` · ${s.reason}` : ""}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold text-muted">자막 (편집 후 영상 기준)</p>
            <ul className="space-y-0.5 text-sm">
              {plan.hook && <li><span className="font-medium">훅 0–{plan.hook.seconds.toFixed(1)}초</span> {plan.hook.text}</li>}
              {plan.captions.map((c, i) => (
                <li key={i}><span className="font-medium">{clock(c.start)}–{clock(c.end)}</span> {c.text}</li>
              ))}
              {plan.ending && <li><span className="font-medium">엔딩</span> {plan.ending.text}</li>}
              {!plan.hook && !plan.captions.length && !plan.ending && <li className="text-muted">제안된 자막이 없습니다.</li>}
            </ul>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold text-muted">제목 후보</p>
            <ul className="space-y-1 text-sm">
              {plan.titles.map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <span>{t}</span>
                  <button className="text-xs text-accent hover:underline" onClick={() => copy(t)}>복사</button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold text-muted">설명 · 해시태그</p>
            <p className="whitespace-pre-wrap text-sm">{plan.description}</p>
            <p className="mt-1 text-sm text-muted">{plan.hashtags.join(" ")}</p>
            <button className="mt-1 text-xs text-accent hover:underline" onClick={() => copy(`${plan.description}\n\n${plan.hashtags.join(" ")}`)}>
              설명 복사
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <button className="btn-primary w-fit" onClick={render} disabled={rendering || analyzing}>
              {rendering ? `렌더링 중… ${Math.round(progress * 100)}%` : "이 계획으로 영상 만들기"}
            </button>
            {rendering && (
              <div className="h-2 w-full max-w-md overflow-hidden rounded bg-line" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
                <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </div>

          {out && (
            <div className="flex flex-col items-start gap-2">
              <video className="max-h-[560px] max-w-full rounded-md border border-line" controls src={`/api/render/file?id=${out.id}`} />
              <p className="text-xs text-muted">{out.durationSec}초 · {(out.bytes / 1024 / 1024).toFixed(1)}MB</p>
              <a className="btn-primary" href={`/api/render/file?id=${out.id}&download=1`}>mp4 다운로드</a>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
