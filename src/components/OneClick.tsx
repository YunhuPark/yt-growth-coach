"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PrepLive, PrepStep } from "@/lib/prepare";
import type { PrepRecord, Settings } from "@/lib/store";
import { api } from "./shared";

type Info = {
  live: PrepLive | null;
  last: PrepRecord | null;
  weekly: { enabled: boolean; day: number; hour: number };
  nextRun: string | null;
};

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
const hourLabel = (h: number) => `${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}시`;

const ICON: Record<PrepStep["status"], { mark: string; cls: string }> = {
  pending: { mark: "○", cls: "text-muted" },
  running: { mark: "◔", cls: "text-accent" },
  done: { mark: "✓", cls: "text-good" },
  skipped: { mark: "–", cls: "text-muted" },
  failed: { mark: "✕", cls: "text-bad" },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit" });

/** One button for "recommend, then build packages and source candidates", plus the weekly auto-run switch. */
export default function OneClick({ goal, onDone }: { goal: string; onDone: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [packages, setPackages] = useState(2);
  const [sources, setSources] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sawRunning = useRef(false);

  const refresh = useCallback(
    () =>
      api<Info>("/api/prepare")
        .then(setInfo)
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const running = info?.live?.status === "running";

  // While a run is in progress, poll for its progress.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [running, refresh]);

  // When a run this page watched finishes, reload the recommendation and packages shown below.
  useEffect(() => {
    if (running) sawRunning.current = true;
    else if (sawRunning.current) {
      sawRunning.current = false;
      onDone();
    }
  }, [running, onDone]);

  const start = async () => {
    setError(null);
    try {
      await api("/api/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: goal.trim() || undefined, packages, sources }),
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveWeekly = async (w: Info["weekly"]) => {
    setError(null);
    try {
      // The settings endpoint takes the whole object; send back what is stored with the new schedule.
      const s = await api<Settings>("/api/settings");
      await api("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...s, weekly: { enabled: w.enabled, day: w.day, hour: w.hour } }),
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const steps: PrepStep[] | undefined =
    info?.live?.steps?.length ? info.live.steps : info?.last?.steps.map((s) => ({ ...s, key: s.key as PrepStep["key"] }));
  const w = info?.weekly;

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">원클릭 준비</h2>
          <p className="text-xs text-muted">
            채널 데이터와 트렌드를 새로 불러오고 → AI 추천을 만들고 → 상위 아이디어의 제작 패키지와 소재 후보까지 한 번에 준비합니다.
            AI를 약 {packages + 2}번 호출합니다.
          </p>
        </div>
        <button className="btn-primary" onClick={start} disabled={running || !info}>
          {running ? "준비 중…" : "지금 준비하기"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          제작 패키지
          <select className="input w-auto" value={packages} onChange={(e) => setPackages(Number(e.target.value))} disabled={running}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>상위 {n}개</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={sources} onChange={(e) => setSources(e.target.checked)} disabled={running} />
          소재 후보도 찾기 (YouTube 할당량 약 600)
        </label>
      </div>

      {error && <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      {steps && steps.length > 0 && (
        <div className="rounded-md border border-line p-3">
          {!running && info?.last && info.live?.status !== "error" && (
            <p className="mb-2 text-xs text-muted">
              마지막 준비 {when(info.last.at)} · {info.last.trigger === "weekly" ? "주간 자동 실행" : "직접 실행"}
            </p>
          )}
          <ul className="space-y-1">
            {steps.map((s) => (
              <li key={s.key} className="flex gap-2 text-sm">
                <span className={`w-4 shrink-0 text-center ${ICON[s.status].cls}`}>{ICON[s.status].mark}</span>
                <span className={s.status === "pending" ? "text-muted" : ""}>
                  {s.label}
                  {s.detail && <span className="text-xs text-muted"> — {s.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
          {info?.live?.status === "error" && (
            <p className="mt-2 text-sm text-bad">준비를 마치지 못했습니다: {info.live.error}</p>
          )}
        </div>
      )}

      {w && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" checked={w.enabled} onChange={(e) => saveWeekly({ ...w, enabled: e.target.checked })} />
              매주 자동으로 준비하기
            </label>
            <select className="input w-auto" value={w.day} onChange={(e) => saveWeekly({ ...w, day: Number(e.target.value) })}>
              {DAYS.map((d, i) => <option key={d} value={i}>{d}요일</option>)}
            </select>
            <select className="input w-auto" value={w.hour} onChange={(e) => saveWeekly({ ...w, hour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
          </div>
          <p className="text-xs text-muted">
            {w.enabled && info?.nextRun ? `다음 실행: ${when(info.nextRun)}. ` : ""}
            앱이 켜져 있을 때만 실행되고, 그 시각에 꺼져 있었다면 앱을 켠 뒤에 이어서 한 번 실행합니다. 끝나면 성과 추적 탭에 알림이 뜹니다. 같은
            목표를 지난번 추천에서 이어받습니다.
          </p>
        </div>
      )}
    </section>
  );
}
