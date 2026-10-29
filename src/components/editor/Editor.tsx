"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import AutoCut from "./AutoCut";
import AutoEdit from "./AutoEdit";
import AutoReframe from "./AutoReframe";
import { DEMO, DEMO_TOOL } from "@/lib/shared/demo";
import { CaptionStyleProvider } from "./captionStyleContext";
import { EffectsProvider } from "./effectsContext";
import { FramingProvider } from "./framingContext";
import HealthCheck, { HealthWarnings } from "./HealthCheck";
import Highlights from "./Highlights";
import RetentionTool from "./RetentionTool";
import Icon, { type IconName } from "../site/Icon";
import SettingsPanel, { SettingsSummary } from "./SettingsPanel";
import SiteHeader from "../site/SiteHeader";
import SourcePanel from "./SourcePanel";
import { EMPTY_SOURCE, sourceName, sourceReady, type SourceState } from "./source";
import UrlPlan from "./UrlPlan";

type Tool = "shorts" | "auto" | "cut" | "frame" | "retention" | "url";
type StepId = "task" | "video" | "style" | "run";

const TOOLS: { id: Tool; icon: IconName; title: string; blurb: string; uses: "ai" | "local"; needsVideo: boolean; /** the video can be skipped */ optionalVideo?: boolean }[] = [
  { id: "shorts", icon: "clapper", title: "긴 영상에서 쇼츠 뽑기", blurb: "긴 영상에서 쇼츠로 올리기 좋은 구간을 점수와 함께 뽑아 쇼츠로 만듭니다.", uses: "ai", needsVideo: true },
  { id: "auto", icon: "timeline", title: "한 편 자동 편집", blurb: "컷·자막·제목·설명을 AI가 계획하고, 확인한 뒤 영상으로 만듭니다.", uses: "ai", needsVideo: true },
  { id: "cut", icon: "scissors", title: "무음·군말 자르기", blurb: "말이 끊긴 빈 구간과 “음…”, “어…”를 잘라 템포를 빠르게 합니다.", uses: "local", needsVideo: true },
  { id: "frame", icon: "frame", title: "가로 → 세로 자동 프레임", blurb: "가로 영상을 세로로 자를 때 사람·동물을 따라 화면 위치를 옮깁니다.", uses: "local", needsVideo: true },
  { id: "retention", icon: "chart", title: "시청 지속 분석", blurb: "Studio의 시청 지속률 데이터를 붙이면 시청자가 어디서 떠나는지 찾아 줍니다. 영상이 있으면 그 구간을 보고 바로 편집본도 만들어요.", uses: "local", needsVideo: true, optionalVideo: true },
  { id: "url", icon: "link", title: "유튜브 주소로 분석", blurb: "주소만 붙이면 요약·주제·제목·쇼츠 구간·롱폼 구성안을 만듭니다. 영상 파일은 필요 없어요.", uses: "ai", needsVideo: false },
];

const STEP_LABEL: Record<StepId, string> = { task: "작업 고르기", video: "영상 올리기", style: "꾸미기", run: "만들기" };

/** The steps for the chosen task: a task that needs no video skips the video and the finishing choices. */
const stepsFor = (tool: (typeof TOOLS)[number] | undefined): StepId[] => (tool && (!tool.needsVideo || DEMO) ? ["task", "run"] : ["task", "video", "style", "run"]);

/**
 * The editing tools as a short walk, one thing at a time: pick what to do, hand over the video, choose how it should look
 * (optional), then do it. No Google sign-in, no channel, no recommendation needed.
 */
export default function Editor() {
  const [source, setSource] = useState<SourceState>(EMPTY_SOURCE);
  const [toolId, setToolId] = useState<Tool | null>(DEMO ? (DEMO_TOOL as Tool) : null);
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
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    // The button that was pressed is on a screen that is now hidden, so keyboard and screen-reader focus would fall back to the top of
    // the page. Put it on the new screen's title instead.
    setTimeout(() => document.querySelector<HTMLElement>("main section:not([hidden]) h1")?.focus({ preventScroll: true }), 80);
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
    return !steps.slice(0, i).includes("video") || ready || !!tool.optionalVideo;
  };
  const back = at > 0 ? () => go(steps[at - 1]) : undefined;
  const next = at < steps.length - 1 ? () => go(steps[at + 1]) : undefined;

  const nextBlocked: Record<StepId, string | null> = {
    task: tool ? null : "먼저 하고 싶은 작업을 하나 골라 주세요.",
    video: ready || tool?.optionalVideo ? null : "영상을 올리고 권리 확인을 마치면 다음으로 갈 수 있어요.",
    style: null,
    run: null,
  };

  return (
    <CaptionStyleProvider>
      <FramingProvider>
        <EffectsProvider>
          <SiteHeader active="edit">
            {!DEMO && <HealthCheck />}
          </SiteHeader>

          <main id="main" tabIndex={-1} className="mx-auto focus:outline-none flex w-full max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6">
            <Stepper steps={steps} current={step} onGo={go} reachable={reachable} />

            {!DEMO && <HealthWarnings />}

            {/* 1. what to do */}
            <Pane hidden={step !== "task"}>
              <Heading n={1} total={steps.length} title="무엇을 해볼까요?" sub="하고 싶은 작업을 하나 고르세요. 나중에 언제든 바꿀 수 있어요." />
              {DEMO && (
                <p className="callout text-sm">
                  <b>공개 데모입니다.</b> 여기서는 브라우저 안에서만 계산하는 <b>시청 지속 분석</b>을 써 볼 수 있어요. 영상을 올려서 처리하거나 AI를 쓰는 기능은, 영상이 서버로 올라가지 않도록 <Link className="font-semibold underline underline-offset-4" href="/#run">내 컴퓨터에서 실행</Link>하는 방식으로 만들었습니다.
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {TOOLS.map((t) => {
                  const selected = toolId === t.id;
                  const locked = DEMO && t.id !== DEMO_TOOL; // the public demo only runs what needs no server
                  return (
                    <button
                      key={t.id}
                      onClick={() => choose(t.id)}
                      aria-pressed={selected}
                      disabled={locked}
                      className={`relative flex flex-col gap-2 rounded-[10px] border p-5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${selected ? "border-foreground bg-foreground/[0.04] outline outline-1 outline-foreground" : "border-line bg-card enabled:hover:border-foreground/40"}`}
                    >
                      {selected && (
                        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded bg-accent-strong text-on-accent" aria-hidden>
                          <Icon name="check" size={14} />
                        </span>
                      )}
                      <Icon name={t.icon} size={26} />
                      <span className="mt-1 text-lg font-bold leading-tight tracking-tight">{t.title}</span>
                      <span className="text-sm text-muted">{DEMO && t.id === DEMO_TOOL ? "Studio의 시청 지속률 데이터를 붙이면 시청자가 어디서 떠나는지 찾아 줍니다. 계산은 모두 이 브라우저 안에서 해요." : t.blurb}</span>
                      <span className="mt-auto flex flex-wrap gap-1.5 pt-3">
                        <span className={t.uses === "ai" ? "chip-ai" : "chip-local"}>{t.uses === "ai" ? "AI 사용" : "내 컴퓨터에서만"}</span>
                        <span className="chip">{locked ? "내 컴퓨터에서 실행하면 사용" : DEMO ? "파일 없이 가능" : t.optionalVideo ? "영상 파일 선택" : t.needsVideo ? "영상 파일 필요" : "파일 없이 가능"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-sm text-muted">
                <span className="chip-ai">AI 사용</span> 은 분석을 위해 이미지·글자 일부를 AI 서비스로 보내고 사용량만큼 비용이 듭니다.{" "}
                <span className="chip-local">내 컴퓨터에서만</span> 는 영상이 밖으로 나가지 않고 비용도 들지 않습니다.
              </p>
              <StepNav next={next} nextLabel={steps[1] === "run" ? "다음: 시작하기" : "다음: 영상 올리기"} blocked={nextBlocked.task} />
            </Pane>

            {/* 2. the video */}
            <Pane hidden={step !== "video"}>
              <Heading n={2} total={steps.length} title="편집할 영상을 올려 주세요" sub={tool ? (tool.optionalVideo ? `${tool.title}에는 영상이 꼭 필요하지 않아요. 올리면 이탈 구간을 바로 재생하고 편집본·쇼츠를 만들 수 있고, 없으면 건너뛰어도 됩니다.` : `${tool.title}에 쓸 영상이에요. 한 번 올리면 이후 단계에서 계속 이 영상을 씁니다.`) : ""} />
              <SourcePanel source={source} onChange={setSource} hideTitle />
              <StepNav back={back} next={next} nextLabel={tool?.optionalVideo && !ready ? "영상 없이 다음: 꾸미기" : "다음: 꾸미기"} blocked={nextBlocked.video} />
            </Pane>

            {/* 3. how it should look */}
            <Pane hidden={step !== "style"}>
              <Heading n={3} total={steps.length} title="어떻게 꾸밀까요?" sub="모두 선택 사항이에요. 건드리지 않으면 기본 설정으로 만들어집니다." />
              <SettingsPanel />
              <StepNav back={back} next={next} nextLabel="다음: 만들기" blocked={nextBlocked.style} />
            </Pane>

            {/* 4. do it */}
            {(step === "run" || ranOnce) && tool && (
              <Pane hidden={step !== "run"}>
                <Heading n={steps.length} total={steps.length} title="이제 만들어 볼까요?" sub={`${tool.title} · 아래 순서대로 진행하세요. 중간 결과는 뒤로 갔다 와도 남아 있어요.`} />
                <div className="callout flex flex-wrap items-center gap-2">
                  {tool.needsVideo && <span className="chip-local">{sourceName(source) || "영상 없음"}</span>}
                  {tool.needsVideo && <SettingsSummary />}
                  <button className="ml-auto py-1.5 text-sm font-medium underline underline-offset-4" onClick={() => go(tool.needsVideo ? "video" : "task")}>
                    {tool.needsVideo ? "영상·설정 바꾸기" : "작업 바꾸기"}
                  </button>
                </div>

                {tool.id === "auto" && (
                  <fieldset className="flex flex-wrap items-center gap-3 text-sm">
                    <legend className="sr-only">결과 형식</legend>
                    <span className="text-xs font-medium text-muted">결과 형식</span>
                    {(["short", "long"] as const).map((l) => (
                      <label key={l} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 ${layout === l ? "border-foreground bg-foreground/[0.04]" : "border-line"}`}>
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
                  {tool.id === "retention" && <RetentionTool source={source} />}
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

function Heading({ n, total, title, sub }: { n: number; total: number; title: string; sub?: string }) {
  return (
    <div>
      <p className="timecode">
        STEP {String(n).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </p>
      <h1 tabIndex={-1} className="mt-2 text-4xl font-bold focus:outline-none sm:text-5xl">{title}</h1>
      {sub && <p className="mt-3 text-base text-muted">{sub}</p>}
    </div>
  );
}

/** Back and forward at the bottom of a screen. When forward is not allowed yet, it says what is missing. */
function StepNav({ back, next, nextLabel, blocked }: { back?: () => void; next?: () => void; nextLabel?: string; blocked?: string | null }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-line pt-5">
      {back ? (
        <button className="btn !px-5 !py-3 !text-base" onClick={back}>
          ← 이전
        </button>
      ) : (
        <span />
      )}
      {next && (
        <>
          {blocked && <span className="ml-auto text-sm text-muted">{blocked}</span>}
          <button className={`btn-primary gap-2 !px-7 !py-3 !text-base ${blocked ? "" : "ml-auto"}`} onClick={next} disabled={!!blocked}>
            {nextLabel ?? "다음"}
            <Icon name="arrow" size={18} />
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
            <button onClick={() => can && onGo(s)} disabled={!can} aria-current={active ? "step" : undefined} className="flex items-center gap-2.5 disabled:cursor-default">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border font-mono text-sm font-semibold transition-colors ${active ? "border-foreground bg-accent-strong text-on-accent" : done ? "border-foreground text-foreground" : "border-line text-muted"}`}
              >
                {done ? <Icon name="check" size={16} /> : i + 1}
              </span>
              <span className={`sr-only text-sm font-semibold sm:not-sr-only ${active ? "text-foreground" : "text-muted"}`}>{STEP_LABEL[s]}</span>
            </button>
            {i < steps.length - 1 && <span className={`mx-3 h-px flex-1 ${i < at ? "bg-foreground" : "bg-line"}`} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
