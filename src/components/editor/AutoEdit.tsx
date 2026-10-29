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
        summary="영상 한 편의 컷·자막·제목·설명을 AI가 계획하고, 확인한 뒤에 영상으로 만듭니다."
        steps={["주제와 목표 길이를 적습니다","‘AI 편집 계획 만들기’를 누릅니다","계획을 확인하고 고친 뒤 영상으로 만듭니다"]}
        uses="ai"
      >
        영상 파일을 AI가 훑어보고(대표 장면, 장면 전환, 무음 구간, 소리 크기) 버릴 부분을 자르고, 훅·구간 자막과 제목 후보 3개를 제안합니다. 먼저 계획을
          보여 주고, 확인한 뒤에 영상을 만듭니다. 음성 인식을 켜지 않으면 <b>대사는 알아듣지 못하고</b> 자막은 보이는 장면 기준의 문구가 됩니다. 이미지 몇 장(음성
          인식을 켜면 인식된 대사 텍스트도)이 분석을 위해 Anthropic API로 전송됩니다.
      </ToolIntro>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">주제 / 만들려는 영상 (AI에게 전달)
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} />
        </label>
        <label className="field">목표 길이(초)
          <input className="input" inputMode="decimal" value={targetSec} onChange={(e) => setTargetSec(e.target.value)} />
        </label>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input className="mt-1" type="checkbox" checked={speech} onChange={(e) => setSpeech(e.target.checked)} />
        <span>
          <b>음성 인식으로 대사 자막 만들기</b> (이 컴퓨터에서 처리 · 영상 길이에 따라 몇 분 더 걸림 · 한국어 기준)
          <span className="block text-xs text-muted">
            처음 한 번만 음성 인식 모델(Whisper small, 약 240MB)을 Hugging Face에서 내려받아 저장합니다. 이후에는 인터넷 없이 동작합니다. 영상 소리는 밖으로 나가지
            않고, 인식된 글자만 편집 계획을 세우는 AI에게 전달됩니다. 인식 결과는 틀릴 수 있으니 자막을 꼭 확인하세요.
          </span>
        </span>
      </label>

      <p className="rounded-md border border-line bg-card px-3 py-2 text-xs text-muted">
        {sourceReady(source) ? `영상: ${sourceName(source)}` : "위 “1. 편집할 영상”에서 영상을 고르고 권한 확인을 해 주세요."}
      </p>

      {error && <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <button className="btn-primary w-fit" onClick={analyze} disabled={!ready}>
        {analyzing ? `${stage}…` : plan ? "계획 다시 만들기" : "AI 편집 계획 만들기"}
      </button>

      {plan && <PlanPanel plan={plan} layout={long ? "long" : "short"} body={body} disabled={analyzing} clipName={sourceName(source)} />}
    </section>
  );
}
