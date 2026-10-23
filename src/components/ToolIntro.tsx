import type { ReactNode } from "react";

/**
 * The top of every tool: what it does in a line, the few steps to use it, and whether it uses the AI service. Long explanations
 * and what is sent where go under "자세한 설명", so the page is readable at a glance but nothing is hidden for good.
 */
export default function ToolIntro({
  title,
  summary,
  steps,
  uses,
  children,
}: {
  title: string;
  summary: string;
  steps: string[];
  /** "ai": sends pictures or text to the AI service (costs money); "local": everything stays on this computer */
  uses: "ai" | "local";
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xl font-bold">{title}</h3>
        {uses === "ai" ? (
          <span className="chip bg-accent/10 text-accent" title="분석을 위해 이미지나 글자 일부가 AI 서비스(Anthropic API)로 전송되고, 사용량만큼 비용이 듭니다.">AI 사용</span>
        ) : (
          <span className="chip bg-good/15 text-good" title="영상과 화면이 이 컴퓨터 밖으로 나가지 않고, AI 비용도 들지 않습니다.">이 컴퓨터에서만 처리</span>
        )}
      </div>
      <p className="text-[15px]">{summary}</p>
      <ol className="grid gap-2 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s} className="flex items-start gap-2.5 rounded-lg bg-background px-3 py-2.5 text-sm">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-strong text-xs font-bold text-white">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      {children && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted hover:text-foreground">자세한 설명 · 어떤 정보가 어디로 가는지</summary>
          <div className="mt-2 text-xs leading-relaxed text-muted">{children}</div>
        </details>
      )}
    </header>
  );
}
