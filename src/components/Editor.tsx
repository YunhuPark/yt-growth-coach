"use client";

import Link from "next/link";
import { useState } from "react";
import AutoEdit from "./AutoEdit";
import { CaptionStyleProvider } from "./captionStyleContext";
import HealthCheck from "./HealthCheck";
import Highlights from "./Highlights";
import SourcePanel from "./SourcePanel";
import StylePicker from "./StylePicker";
import { EMPTY_SOURCE, type SourceState } from "./source";
import UrlPlan from "./UrlPlan";

type Tool = "shorts" | "auto" | "url";

const TOOLS: { id: Tool; title: string; blurb: string }[] = [
  { id: "shorts", title: "긴 영상에서 쇼츠 뽑기", blurb: "긴 영상 하나에서 쇼츠로 올리기 좋은 구간을 점수와 함께 뽑고, 자막을 붙여 쇼츠로 만듭니다." },
  { id: "auto", title: "한 편 자동 편집", blurb: "영상 한 편의 컷·자막·제목·설명을 AI가 계획하고, 확인한 뒤 영상으로 만듭니다." },
  { id: "url", title: "영상 주소로 분석", blurb: "유튜브 주소만으로 요약·주제·제목·쇼츠 구간·롱폼 구성안을 만듭니다(파일 없이도 가능)." },
];

/**
 * The editing tools on their own page: no Google sign-in, no channel, no recommendation needed. Pick a video once, pick what to
 * do with it, review, make.
 */
export default function Editor() {
  const [source, setSource] = useState<SourceState>(EMPTY_SOURCE);
  const [tool, setTool] = useState<Tool>("shorts");
  const [layout, setLayout] = useState<"short" | "long">("short");

  return (
    <CaptionStyleProvider>
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">영상 편집 도우미</h1>
          <p className="text-sm text-muted">영상을 고르고, 하고 싶은 작업을 고르고, AI의 제안을 확인한 뒤 만듭니다. Google 계정 연결은 필요 없습니다.</p>
        </div>
        <Link className="btn" href="/">채널 분석 · 추천 · 성과 추적 →</Link>
      </header>

      <HealthCheck />

      <SourcePanel source={source} onChange={setSource} />

      <StylePicker title="2. 자막 스타일 (선택)" />

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">3. 무엇을 할까요?</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              className={`rounded-lg border p-3 text-left ${tool === t.id ? "border-accent bg-accent/5" : "border-line hover:border-accent/50"}`}
            >
              <span className="block text-sm font-semibold">{t.title}</span>
              <span className="mt-1 block text-xs text-muted">{t.blurb}</span>
            </button>
          ))}
        </div>

        {tool === "auto" && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-xs text-muted">결과 형식</span>
            {(["short", "long"] as const).map((l) => (
              <label key={l} className="flex items-center gap-1.5">
                <input type="radio" name="layout" checked={layout === l} onChange={() => setLayout(l)} />
                {l === "short" ? "쇼츠 (세로 1080×1920)" : "롱폼 (가로 1920×1080)"}
              </label>
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">4. 결과 확인하고 만들기</h2>
        {tool === "shorts" && <Highlights topic="" source={source} />}
        {tool === "auto" && <AutoEdit key={layout} topic="" layout={layout} source={source} />}
        {tool === "url" && <UrlPlan topic="" source={source} />}
      </div>
    </main>
    </CaptionStyleProvider>
  );
}
