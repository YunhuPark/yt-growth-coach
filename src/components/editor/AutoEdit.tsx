"use client";

import { useState } from "react";
import type { EditPlan } from "@/lib/editor/autoEdit";
import PlanPanel from "./PlanPanel";
import ToolIntro from "./ToolIntro";
import { api } from "../shared";
import { sourceName, sourceReady, type SourceState } from "./source";

type AutoStatus = { status: "running" | "done" | "error"; stage: string; error?: string; plan?: EditPlan; duration?: number };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** C. The AI looks at the footage, proposes cuts, captions and titles; the creator reviews, then renders. */
export default function AutoEdit({ topic: initialTopic, layout, source }: { topic: string; layout: "short" | "long"; source: SourceState }) {
  const long = layout === "long";
  const { file, sourcePath, basis } = source;
  const [targetSec, setTargetSec] = useState(long ? "480" : "40");
  const [topic, setTopic] = useState(initialTopic);
  const [speech, setSpeech] = useState(false);

  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<EditPlan | null>(null);

  const analyzing = stage !== null;
  const ready = sourceReady(source) && !analyzing;

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
    setStage("올리는 중");
    try {
      const res = await fetch("/api/autoedit", {
        method: "POST",
        body: body({ layout: long ? "long" : "short", topic, targetSec: Number(targetSec) || (long ? 480 : 40), speech }),
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

  return (
    <section className="card flex flex-col gap-4">
      <ToolIntro
        icon="timeline"
        title="한 편 자동 편집"
        summary="컷·자막·제목·설명을 AI가 계획하고, 확인한 뒤 영상으로 만들어요."
        steps={["주제와 목표 길이를 적습니다", "‘AI 편집 계획 만들기’를 누릅니다", "계획을 확인하고 고친 뒤 영상으로 만듭니다"]}
        uses="ai"
        notes={[
          "AI는 대표 장면과 소리 크기를 보고 계획해요. 이미지 몇 장(음성 인식을 켜면 대사 글자도)이 AI로 전송돼요.",
          "음성 인식을 끄면 AI가 말을 듣지 못해요. 말하는 영상이면 켜세요.",
          "자막은 받아쓰기가 아니라 AI가 쓴 문장이에요(말한 내용을 참고만 해요). 말한 그대로 넣으려면 ‘긴 영상에서 쇼츠 뽑기’의 자막 편집을 쓰세요.",
          "계획을 먼저 보여 주고, 확인한 뒤에 영상을 만들어요.",
        ]}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">주제 / 만들려는 영상
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} />
        </label>
        <label className="field">목표 길이(초)
          <input className="input" inputMode="decimal" value={targetSec} onChange={(e) => setTargetSec(e.target.value)} />
        </label>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input className="mt-1" type="checkbox" checked={speech} onChange={(e) => setSpeech(e.target.checked)} />
        <span>
          <b>음성 인식으로 대사 듣기</b> (말하는 영상이면 추천)
          <span className="block text-xs text-muted">끄면 AI가 화면만 보고 계획해요. 시간이 더 걸리고, 처음 한 번 모델(약 240MB)을 받아요. 인식은 틀릴 수 있어요.</span>
        </span>
      </label>

      {!sourceReady(source) && <p className="rounded-md border border-line bg-card px-3 py-2 text-xs text-muted">영상을 먼저 올려 주세요.</p>}

      {error && <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <button className="btn-primary w-fit" onClick={analyze} disabled={!ready}>
        {analyzing ? `${stage}…` : plan ? "계획 다시 만들기" : "AI 편집 계획 만들기"}
      </button>

      {plan && <PlanPanel plan={plan} layout={long ? "long" : "short"} body={body} disabled={analyzing} clipName={sourceName(source)} />}
    </section>
  );
}
