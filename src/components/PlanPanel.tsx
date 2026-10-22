"use client";

import { useState } from "react";
import type { EditPlan } from "@/lib/autoEdit";
import { formatClock, withChapterCards } from "@/lib/chapters";
import { planCues } from "@/lib/exporters";
import { useCaptionStyle } from "./captionStyleContext";
import { useEffectsOption } from "./effectsContext";
import { useReframeOption } from "./framingContext";
import ExportMenu from "./ExportMenu";
import { api } from "./shared";

type RenderStatus = {
  status: "running" | "done" | "error";
  progress: number;
  stage?: string;
  note?: string;
  error?: string;
  result?: { durationSec: number; bytes: number; layout: "short" | "long" };
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => {});

/**
 * An AI edit plan laid out for review, with the button that renders it. `body` builds the multipart request for the source
 * video (file or path plus the rights confirmation) around the render options this panel supplies.
 */
export default function PlanPanel({
  plan,
  layout,
  body,
  disabled,
  clipName = "",
}: {
  plan: EditPlan;
  layout: "short" | "long";
  body: (options: object) => FormData;
  disabled?: boolean;
  /** the source video's name, written into the exported cut list */
  clipName?: string;
}) {
  const { style } = useCaptionStyle();
  const effects = useEffectsOption();
  const follow = useReframeOption("short");
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<{ id: string; durationSec: number; bytes: number } | null>(null);

  // On a long video each chapter after the first gets a title card, in place of any caption under it.
  const captions = layout === "long" && plan.chapters.length ? withChapterCards(plan.captions, plan.chapters) : plan.captions;

  const render = async () => {
    setError(null);
    setOut(null);
    setNote(null);
    setStage(null);
    setProgress(0);
    setRendering(true);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        body: body({
          layout,
          fit: "blur",
          segments: plan.segments.map(({ start, end }) => ({ start, end })),
          hook: plan.hook ?? undefined,
          captions,
          ending: plan.ending ?? undefined,
          style,
          effects,
          reframe: layout === "short" ? follow : undefined,
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
    <div className="flex flex-col gap-4 rounded-md border border-line p-3">
      <p className="text-sm">{plan.summary}</p>
      {plan.warnings.map((w) => (
        <p key={w} className="rounded-md border border-line bg-card px-3 py-2 text-xs text-muted">{w}</p>
      ))}

      <div>
        <p className="mb-1 text-xs font-semibold text-muted">남길 구간 · 결과 {plan.outputSec >= 120 ? `${Math.round(plan.outputSec / 60)}분` : `${plan.outputSec}초`}</p>
        <ul className="space-y-0.5 text-sm">
          {plan.segments.map((s, i) => (
            <li key={i}>
              <span className="font-medium">{clock(s.start)}–{clock(s.end)}</span>{" "}
              <span className="text-xs text-muted">({(s.end - s.start).toFixed(1)}초){s.reason ? ` · ${s.reason}` : ""}</span>
            </li>
          ))}
        </ul>
      </div>

      {plan.chapters.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-muted">챕터 (편집 후 영상 기준 · 설명에 들어가고, 첫 챕터를 뺀 각 챕터에 제목 카드가 뜹니다)</p>
          <ul className="space-y-0.5 text-sm">
            {plan.chapters.map((c) => (
              <li key={c.time}><span className="font-medium">{formatClock(c.time)}</span> {c.title}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-semibold text-muted">자막 (편집 후 영상 기준)</p>
        <ul className="space-y-0.5 text-sm">
          {plan.hook && <li><span className="font-medium">훅 0–{plan.hook.seconds.toFixed(1)}초</span> {plan.hook.text}</li>}
          {captions.map((c, i) => (
            <li key={i}><span className="font-medium">{clock(c.start)}–{clock(c.end)}</span> {c.text}</li>
          ))}
          {plan.ending && <li><span className="font-medium">엔딩</span> {plan.ending.text}</li>}
          {!plan.hook && !captions.length && !plan.ending && <li className="text-muted">제안된 자막이 없습니다.</li>}
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

      <ExportMenu
        baseName={plan.titles[0] ?? "편집 계획"}
        clipName={clipName}
        cues={planCues({ hook: plan.hook, captions, ending: plan.ending, outputSec: plan.outputSec })}
        cuts={plan.segments}
      />

      {error && <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <div className="flex flex-col gap-2">
        <button className="btn-primary w-fit" onClick={render} disabled={rendering || disabled}>
          {rendering ? (stage ? `${stage}…` : `렌더링 중… ${Math.round(progress * 100)}%`) : "이 계획으로 영상 만들기"}
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
          {note && <p className="text-xs text-bad">{note}</p>}
          <a className="btn-primary" href={`/api/render/file?id=${out.id}&download=1`}>mp4 다운로드</a>
        </div>
      )}
    </div>
  );
}
