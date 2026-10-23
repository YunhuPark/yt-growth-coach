"use client";

import { useEffect, useState } from "react";
import type { HealthItem } from "@/lib/health";
import { api } from "./shared";

const NAME: Record<HealthItem["id"], string> = {
  ffmpeg: "영상 처리 엔진",
  font: "한글 자막 폰트",
  anthropic: "AI 키 (Anthropic)",
  youtubeKey: "YouTube API 키",
  speechModel: "음성 인식 모델",
  personModel: "대상 인식 모델 (자동 프레임)",
  google: "Google 계정 연결",
};

/**
 * What is in place and what is missing, as a small badge that opens the list. Something required that is missing is also shown
 * as a plain warning, because the tools cannot work without it.
 */
export default function HealthCheck() {
  const [items, setItems] = useState<HealthItem[] | null>(null);

  useEffect(() => {
    api<HealthItem[]>("/api/health").then(setItems).catch(() => setItems([]));
  }, []);

  if (!items || items.length === 0) return null;
  const blocking = items.filter((i) => i.required && !i.ok);
  const done = items.filter((i) => i.ok).length;

  return (
    <div className="relative">
      <details className="group">
        <summary
          className={`chip cursor-pointer list-none select-none px-3 py-1 ${blocking.length ? "bg-bad/15 text-bad" : "bg-good/15 text-good"}`}
          aria-label="준비 상태 보기"
        >
          <span aria-hidden>{blocking.length ? "●" : "✓"}</span> 준비 상태 {done}/{items.length}
        </summary>
        <div className="card absolute right-0 z-20 mt-2 w-[min(22rem,90vw)] shadow-lg">
          <p className="mb-2 text-sm font-semibold">이 도구가 쓰는 것들</p>
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.id} className="flex gap-2 text-xs">
                <span className={`w-4 shrink-0 text-center ${i.ok ? "text-good" : i.required ? "text-bad" : "text-muted"}`}>{i.ok ? "✓" : i.required ? "✕" : "–"}</span>
                <span>
                  <b>{NAME[i.id]}</b>
                  {!i.required && <span className="text-muted"> (선택)</span>}
                  {!i.ok && <span className="block text-muted">{i.fix}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}

/** The warnings for what is required but missing, to show where they cannot be missed. Nothing when all is in place. */
export function HealthWarnings() {
  const [items, setItems] = useState<HealthItem[]>([]);
  useEffect(() => {
    api<HealthItem[]>("/api/health").then(setItems).catch(() => setItems([]));
  }, []);
  const blocking = items.filter((i) => i.required && !i.ok);
  if (!blocking.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {blocking.map((i) => (
        <p key={i.id} className="rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
          <b>{NAME[i.id]}</b> — {i.fix}
        </p>
      ))}
    </div>
  );
}
