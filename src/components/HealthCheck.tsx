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

/** What is in place and what is missing, with what to do about each. Required items that are missing are shown first and loudly. */
export default function HealthCheck() {
  const [items, setItems] = useState<HealthItem[] | null>(null);

  useEffect(() => {
    api<HealthItem[]>("/api/health").then(setItems).catch(() => setItems([]));
  }, []);

  if (!items || items.length === 0) return null;
  const blocking = items.filter((i) => i.required && !i.ok);
  const optional = items.filter((i) => !i.required && !i.ok);

  return (
    <section className="flex flex-col gap-2">
      {blocking.map((i) => (
        <p key={i.id} className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          <b>{NAME[i.id]}</b> — {i.fix}
        </p>
      ))}
      <details className="rounded-md border border-line px-3 py-2 text-sm" open={blocking.length > 0}>
        <summary className="cursor-pointer text-xs text-muted">
          준비 상태 · {items.filter((i) => i.ok).length}/{items.length} 완료{optional.length ? ` · 선택 항목 ${optional.length}개 미설정` : ""}
        </summary>
        <ul className="mt-2 space-y-1.5">
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
      </details>
    </section>
  );
}
