import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

/**
 * The top of every tool: what it does in a line, the few steps to use it, and whether it uses the AI service. Long explanations
 * and what is sent where go under "자세한 설명", so the page is readable at a glance but nothing is hidden for good.
 */
export default function ToolIntro({
  title,
  summary,
  steps,
  uses,
  icon,
  children,
}: {
  title: string;
  summary: string;
  steps: string[];
  /** "ai": sends pictures or text to the AI service (costs money); "local": everything stays on this computer */
  uses: "ai" | "local";
  icon?: IconName;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {icon && <Icon name={icon} size={24} />}
        <h2 className="text-xl font-bold">{title}</h2>
        {uses === "ai" ? (
          <span className="chip-ai" title="분석을 위해 이미지나 글자 일부가 AI 서비스(Anthropic API)로 전송되고, 사용량만큼 비용이 듭니다.">AI 사용</span>
        ) : (
          <span className="chip-local" title="영상과 화면이 이 컴퓨터 밖으로 나가지 않고, AI 비용도 들지 않습니다.">이 컴퓨터에서만 처리</span>
        )}
      </div>
      <p className="text-[15px]">{summary}</p>
      <ol className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s} className="flex items-start gap-3 bg-card px-4 py-3 text-sm">
            <span className="timecode mt-0.5 !text-foreground">{String(i + 1).padStart(2, "0")}</span>
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
