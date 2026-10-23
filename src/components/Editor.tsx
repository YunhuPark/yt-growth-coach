"use client";

import { useState, type ReactNode } from "react";
import AutoCut from "./AutoCut";
import AutoEdit from "./AutoEdit";
import AutoReframe from "./AutoReframe";
import { CaptionStyleProvider } from "./captionStyleContext";
import { EffectsProvider } from "./effectsContext";
import { FramingProvider } from "./framingContext";
import HealthCheck, { HealthWarnings } from "./HealthCheck";
import Highlights from "./Highlights";
import SettingsPanel, { SettingsSummary } from "./SettingsPanel";
import SiteHeader from "./SiteHeader";
import SourcePanel from "./SourcePanel";
import { EMPTY_SOURCE, sourceName, sourceReady, type SourceState } from "./source";
import UrlPlan from "./UrlPlan";

type Tool = "shorts" | "auto" | "cut" | "frame" | "url";
type StepId = "task" | "video" | "style" | "run";

const TOOLS: { id: Tool; icon: string; title: string; blurb: string; uses: "ai" | "local"; needsVideo: boolean }[] = [
  { id: "shorts", icon: "🎬", title: "긴 영상에서 쇼츠 뽑기", blurb: "긴 영상에서 쇼츠로 올리기 좋은 구간을 점수와 함께 뽑아 쇼츠로 만듭니다.", uses: "ai", needsVideo: true },
  { id: "auto", icon: "✨", title: "한 편 자동 편집", blurb: "컷·자막·제목·설명을 AI가 계획하고, 확인한 뒤 영상으로 만듭니다.", uses: "ai", needsVideo: true },
  { id: "cut", icon: "✂️", title: "무음·군말 자르기", blurb: "말이 끊긴 빈 구간과 “음…”, “어…”를 잘라 템포를 빠르게 합니다.", uses: "local", needsVideo: true },
  { id: "frame", icon: "📱", title: "가로 → 세로 자동 프레임", blurb: "가로 영상을 세로로 자를 때 사람·동물을 따라 화면 위치를 옮깁니다.", uses: "local", needsVideo: true },
  { id: "url", icon: "🔗", title: "유튜브 주소로 분석", blurb: "주소만 붙이면 요약·주제·제목·쇼츠 구간·롱폼 구성안을 만듭니다. 영상 파일은 필요 없어요.", uses: "ai", needsVideo: false },
];

const STEP_LABEL: Record<StepId, string> = { task: "작업 고르기", video: "영상 올리기", style: "꾸미기", run: "만들기" };

/** The steps for the chosen task: a task that needs no video skips the video and the finishing choices. */
const stepsFor = (tool: (typeof TOOLS)[number] | undefined): StepId[] => (tool && !tool.needsVideo ? ["task", "run"] : ["task", "video", "style", "run"]);

/**
 * The editing tools as a short walk, one thing at a time: pick what to do, hand over the video, choose how it should look
 * (optional), then do it. No Google sign-in, no channel, no recommendation needed.
 */
export default function Editor() {
  const [source, setSource] = useState<SourceState>(EMPTY_SOURCE);
  const [toolId, setToolId] = useState<Tool | null>(null);
  const [step, setStep] = useState<StepId>("task");
  const [ranOnce, setRanOnce] = useState(false);
  const [layout, setLayout] = useState<"short" | "long">("short");

  const tool = TOOLS.find((t) => t.id === toolId);
  const steps = stepsFor(tool);
  const at = Math.max(0, steps.indexOf(step));
  const ready = sourceReady(source);

  const go = (s: StepId) => {
    setStep(s);
    if (s === "run") setRanOnce(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const choose = (id: Tool) => {
    if (id !== toolId) setRanOnce(false); // another task starts its own panel
    setToolId(id);
  };
  // a step can be opened when it is behind us, or when everything it needs before it is done
  const reachable = (s: StepId) => {
    const i = steps.indexOf(s);
    if (i <= at) return true;
    if (!tool) return false;
    return !steps.slice(0, i).includes("video") || ready;
  };
  const back = at > 0 ? () => go(steps[at - 1]) : undefined;
  const next = at < steps.length - 1 ? () => go(steps[at + 1]) : undefined;

  const nextBlocked: Record<StepId, string | null> = {
    task: tool ? null : "먼저 하고 싶은 작업을 하나 골라 주세요.",
    video: ready ? null : "영상을 올리고 권리 확인을 마치면 다음으로 갈 수 있어요.",
    style: null,
    run: null,
  };

  return (
    <CaptionStyleProvider>
      <FramingProvider>
        <EffectsProvider>
          <SiteHeader active="edit">
            <HealthCheck />
          </SiteHeader>

          <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6">
            <Stepper steps={steps} current={step} onGo={go} reachable={reachable} />

            <HealthWarnings />

            {/* 1. what to do */}
            <Pane hidden={step !== "task"}>
              <Heading title="무엇을 해볼까요?" sub="하고 싶은 작업을 하나 고르세요. 나중에 언제든 바꿀 수 있어요." />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {TOOLS.map((t) => {
                  const selected = toolId === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => choose(t.id)}
                      aria-pressed={selected}
                      className={`group relative flex flex-col gap-2 rounded-2xl border-2 p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${selected ? "border-accent bg-accent/5 ring-2 ring-accent/20" : "border-line bg-card hover:border-accent/50"}`}
                    >
                      {selected && <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-accent-strong text-xs font-bold text-white" aria-hidden>✓</span>}
                      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-3xl" aria-hidden>{t.icon}</span>
                      <span className="text-lg font-bold leading-tight">{t.title}</span>
                      <span className="text-sm text-muted">{t.blurb}</span>
                      <span className="mt-auto flex flex-wrap gap-1.5 pt-2">
                        <span className={`chip ${t.uses === "ai" ? "bg-accent/10 text-accent" : "bg-good/15 text-good"}`}>{t.uses === "ai" ? "AI 사용" : "내 컴퓨터에서만"}</span>
                        <span className="chip">{t.needsVideo ? "영상 파일 필요" : "파일 없이 가능"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-sm text-muted">
                <span className="chip bg-accent/10 text-accent">AI 사용</span> 은 분석을 위해 이미지·글자 일부를 AI 서비스로 보내고 사용량만큼 비용이 듭니다.{" "}
                <span className="chip bg-good/15 text-good">내 컴퓨터에서만</span> 는 영상이 밖으로 나가지 않고 비용도 들지 않습니다.
              </p>
              <StepNav next={next} nextLabel="다음: 영상 올리기 →" blocked={nextBlocked.task} />
            </Pane>

            {/* 2. the video */}
            <Pane hidden={step !== "video"}>
              <Heading title="편집할 영상을 올려 주세요" sub={tool ? `${tool.icon} ${tool.title}에 쓸 영상이에요. 한 번 올리면 이후 단계에서 계속 이 영상을 씁니다.` : ""} />
              <SourcePanel source={source} onChange={setSource} hideTitle />
              <StepNav back={back} next={next} nextLabel="다음: 꾸미기 →" blocked={nextBlocked.video} />
            </Pane>

            {/* 3. how it should look */}
            <Pane hidden={step !== "style"}>
              <Heading title="어떻게 꾸밀까요?" sub="모두 선택 사항이에요. 건드리지 않으면 기본 설정으로 만들어집니다." />
              <SettingsPanel />
              <StepNav back={back} next={next} nextLabel="다음: 만들기 →" blocked={nextBlocked.style} />
            </Pane>

            {/* 4. do it */}
            {(step === "run" || ranOnce) && tool && (
              <Pane hidden={step !== "run"}>
                <Heading title="이제 만들어 볼까요?" sub={`${tool.icon} ${tool.title} · 아래 순서대로 진행하세요. 중간 결과는 뒤로 갔다 와도 남아 있어요.`} />
                <div className="callout flex flex-wrap items-center gap-2">
                  {tool.needsVideo && <span className="chip bg-good/15 text-good">🎞️ {sourceName(source) || "영상 없음"}</span>}
                  {tool.needsVideo && <SettingsSummary />}
                  <button className="ml-auto text-sm font-medium text-accent underline" onClick={() => go(tool.needsVideo ? "video" : "task")}>
                    {tool.needsVideo ? "영상·설정 바꾸기" : "작업 바꾸기"}
                  </button>
                </div>

                {tool.id === "auto" && (
                  <fieldset className="flex flex-wrap items-center gap-3 text-sm">
                    <legend className="sr-only">결과 형식</legend>
                    <span className="text-xs font-medium text-muted">결과 형식</span>
                    {(["short", "long"] as const).map((l) => (
                      <label key={l} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 ${layout === l ? "border-accent bg-accent/5" : "border-line"}`}>
                        <input type="radio" name="layout" checked={layout === l} onChange={() => setLayout(l)} />
                        {l === "short" ? "쇼츠 (세로 1080×1920)" : "롱폼 (가로 1920×1080)"}
                      </label>
                    ))}
                  </fieldset>
                )}

                <div key={tool.id}>
                  {tool.id === "shorts" && <Highlights topic="" source={source} />}
                  {tool.id === "auto" && <AutoEdit key={layout} topic="" layout={layout} source={source} />}
                  {tool.id === "cut" && <AutoCut source={source} />}
                  {tool.id === "frame" && <AutoReframe source={source} />}
                  {tool.id === "url" && <UrlPlan topic="" source={source} />}
                </div>
                <StepNav back={back} />
              </Pane>
            )}
          </main>
        </EffectsProvider>
      </FramingProvider>
    </CaptionStyleProvider>
  );
}

/** One screen of the walk. Hidden screens stay mounted, so what was typed or found is still there when coming back. */
function Pane({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  return (
    <section hidden={hidden} className="flex flex-col gap-6">
      {children}
    </section>
  );
}

function Heading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{title}</h1>
      {sub && <p className="mt-2 text-base text-muted">{sub}</p>}
    </div>
  );
}

/** Back and forward at the bottom of a screen. When forward is not allowed yet, it says what is missing. */
function StepNav({ back, next, nextLabel, blocked }: { back?: () => void; next?: () => void; nextLabel?: string; blocked?: string | null }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-line pt-5">
      {back ? <button className="btn !px-5 !py-3 !text-base" onClick={back}>← 이전</button> : <span />}
      {next && (
        <>
          {blocked && <span className="ml-auto text-sm text-muted">{blocked}</span>}
          <button className={`btn-primary !px-7 !py-3 !text-base ${blocked ? "" : "ml-auto"}`} onClick={next} disabled={!!blocked}>
            {nextLabel ?? "다음 →"}
          </button>
        </>
      )}
    </div>
  );
}

/** The path across the top: where you are, what is done (click to go back), what is still ahead. */
function Stepper({ steps, current, onGo, reachable }: { steps: StepId[]; current: StepId; onGo: (s: StepId) => void; reachable: (s: StepId) => boolean }) {
  const at = Math.max(0, steps.indexOf(current));
  return (
    <ol className="flex items-center" aria-label="진행 단계">
      {steps.map((s, i) => {
        const done = i < at;
        const active = i === at;
        const can = reachable(s);
        return (
          <li key={s} className="flex flex-1 items-center last:flex-none">
            <button
              onClick={() => can && onGo(s)}
              disabled={!can}
              aria-current={active ? "step" : undefined}
              className="flex items-center gap-2 disabled:cursor-default"
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors ${active ? "bg-accent-strong text-white ring-4 ring-accent/20" : done ? "bg-accent/15 text-accent" : "bg-line text-muted"}`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className={`hidden text-sm font-semibold sm:inline ${active ? "text-foreground" : "text-muted"}`}>{STEP_LABEL[s]}</span>
            </button>
            {i < steps.length - 1 && <span className={`mx-3 h-0.5 flex-1 rounded ${i < at ? "bg-accent/40" : "bg-line"}`} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
