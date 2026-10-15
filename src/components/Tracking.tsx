"use client";

import { useCallback, useEffect, useState } from "react";
import type { CollectEvent } from "@/lib/store";
import type { BaselineSummary, Evaluated, LeverResult, Metric } from "@/lib/tracking";
import { api, fmt } from "./shared";

type Cand = { id: string; title: string; publishedAt: string; format: "short" | "long"; views: number };
type Lever = { id: string; label: string; metric: Metric };
type Resp = {
  baseline: BaselineSummary | null;
  entries: Evaluated[];
  learned: LeverResult[];
  candidates: Cand[];
  ideas: string[];
  levers: Lever[];
};

type CollectStatus = {
  lastRunAt: string | null;
  lastError: string | null;
  lastResult: { newVideos: number; newEvents: number; checked: number } | null;
  autoOn: boolean;
  unread: number;
  events: CollectEvent[];
};

const METRICS: { key: Metric; label: string; d: number; unit: string }[] = [
  { key: "views", label: "조회수", d: 0, unit: "" },
  { key: "cvr", label: "구독 전환(1천 조회당)", d: 2, unit: "" },
  { key: "cta", label: "CTA 반응(댓글+공유)", d: 2, unit: "%" },
  { key: "ret", label: "지속률", d: 0, unit: "%" },
];
const DAYS = [1, 3, 7] as const;

/** pct is the share of my past videos this one beat, so "top X%" is the complement. */
const top = (pct?: number) => (pct === undefined ? undefined : Math.max(1, 100 - pct));
const tone = (pct?: number) => (pct === undefined ? "" : pct >= 75 ? "text-good" : pct <= 25 ? "text-bad" : "");

const readyDate = (publishedAt: string, n: number) =>
  new Date(Date.parse(publishedAt) + (n + 1) * 86400_000).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });

export default function Tracking({ onUnread }: { onUnread?: (n: number) => void }) {
  const [data, setData] = useState<Resp | null>(null);
  const [collect, setCollect] = useState<CollectStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const applyCollect = useCallback(
    (c: CollectStatus) => {
      setCollect(c);
      onUnread?.(c.unread);
    },
    [onUnread],
  );

  const loadCollect = useCallback(
    () => api<CollectStatus>("/api/collect").then(applyCollect).catch(() => {}),
    [applyCollect],
  );

  const load = useCallback(
    () =>
      api<Resp>("/api/tracking")
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    load();
    loadCollect();
  }, [load, loadCollect]);

  const collectAction = async (action: "run" | "read") => {
    setBusy(action === "run" ? "collect" : null);
    setError(null);
    try {
      applyCollect(
        await api<CollectStatus>("/api/collect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }),
      );
      if (action === "run") await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const buildBaseline = async (refresh = false) => {
    setBusy("baseline");
    setError(null);
    try {
      await api("/api/tracking/baseline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh }),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <p className="text-muted">{error ?? "불러오는 중…"}</p>;

  return (
    <div className="flex flex-col gap-5">
      {error && <div className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>}

      {collect && (
        <AutoCollect c={collect} busy={busy === "collect"} onRun={() => collectAction("run")} onRead={() => collectAction("read")} />
      )}

      <Baseline b={data.baseline} busy={busy === "baseline"} onBuild={buildBaseline} />

      {data.baseline && <LinkForm data={data} onLinked={load} setError={setError} />}

      {data.entries.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">추적 중인 영상</h2>
          {data.entries.map((e) => (
            <EntryCard
              key={e.videoId}
              e={e}
              levers={data.levers}
              ideas={data.ideas}
              onChanged={load}
              setError={setError}
              onDelete={async () => {
                await api(`/api/tracking?id=${e.videoId}`, { method: "DELETE" });
                load();
              }}
            />
          ))}
        </section>
      )}

      {data.learned.length > 0 && <Learned rows={data.learned} />}
    </div>
  );
}

function Baseline({ b, busy, onBuild }: { b: BaselineSummary | null; busy: boolean; onBuild: (refresh?: boolean) => void }) {
  if (!b) {
    return (
      <section className="card flex flex-col gap-2">
        <h2 className="font-semibold">1단계 · 내 기준선 만들기</h2>
        <p className="text-sm text-muted">
          새 영상이 잘 나왔는지 판단하려면 비교 기준이 필요합니다. 내 기존 영상들의 <b>첫 1·3·7일 성적</b>(조회수, 구독 전환, CTA 반응,
          지속률)을 한 번 계산해 둡니다. 영상 수에 따라 30초~1분 걸립니다.
        </p>
        <div>
          <button className="btn-primary" onClick={() => onBuild()} disabled={busy}>
            {busy ? "계산 중…" : "기준선 만들기"}
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">내 기준선 · 이 숫자를 넘기면 기존보다 잘 나온 것</h2>
          <p className="text-xs text-muted">
            기존 영상 {b.n}개의 첫 N일 누적 성적 · {new Date(b.at).toLocaleDateString("ko-KR")} 계산
          </p>
        </div>
        <button className="btn" onClick={() => onBuild(true)} disabled={busy}>
          {busy ? "다시 계산 중…" : "다시 계산"}
        </button>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-1 pr-3">지표</th>
              {DAYS.map((d) => (
                <th key={d} className="px-2">{d}일차 <span className="font-normal">(중앙 · 상위25% · 상위10%)</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRICS.filter((m) => m.key !== "ret").map((m) => (
              <tr key={m.key} className="border-t border-line">
                <td className="py-1.5 pr-3">{m.label}</td>
                {DAYS.map((d) => {
                  const s = b.byN[String(d)]?.[m.key];
                  return (
                    <td key={d} className="px-2 text-xs">
                      {s ? [s.p50, s.p75, s.p90].map((x) => `${fmt(x, m.d)}${m.unit}`).join(" · ") : "–"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LinkForm({ data, onLinked, setError }: { data: Resp; onLinked: () => void; setError: (e: string | null) => void }) {
  const [picked, setPicked] = useState("");
  const [url, setUrl] = useState("");
  const [idea, setIdea] = useState("");
  const [levers, setLevers] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const video = url.trim() || picked;
    if (!video) return setError("추적할 영상을 선택하거나 주소를 붙여넣어 주세요.");
    setBusy(true);
    setError(null);
    try {
      await api("/api/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video, ideaTitle: idea || undefined, levers, note: note || undefined }),
      });
      setPicked("");
      setUrl("");
      setIdea("");
      setLevers([]);
      setNote("");
      onLinked();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card flex flex-col gap-3">
      <div>
        <h2 className="font-semibold">2단계 · 새로 올린 영상 연결</h2>
        <p className="text-xs text-muted">
          영상을 올린 뒤 연결하면 1·3·7일차마다 기준선과 비교합니다. 시도한 요소를 함께 체크해야 “어떤 시도가 먹혔는지” 알 수 있습니다.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">최근 90일 안에 올린 영상에서 선택
          <select className="input" value={picked} onChange={(e) => setPicked(e.target.value)}>
            <option value="">{data.candidates.length ? "선택하세요" : "최근 90일 안에 올린 영상이 없습니다"}</option>
            {data.candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.publishedAt.slice(0, 10)} · {c.title.slice(0, 40)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">또는 영상 주소 붙여넣기
          <input className="input" placeholder="https://youtube.com/shorts/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label className="field">어떤 추천 아이디어로 만들었나요? (선택)
          <select className="input" value={idea} onChange={(e) => setIdea(e.target.value)}>
            <option value="">직접 만든 영상</option>
            {data.ideas.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">메모 (선택)
          <input className="input" placeholder="예: 서열 시리즈 1편" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <fieldset className="flex flex-wrap gap-x-5 gap-y-1.5">
        <legend className="mb-1 text-xs text-muted">이번 영상에서 시도한 것</legend>
        {data.levers.map((l) => (
          <label key={l.id} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={levers.includes(l.id)}
              onChange={(e) => setLevers(e.target.checked ? [...levers, l.id] : levers.filter((x) => x !== l.id))}
            />
            {l.label}
          </label>
        ))}
      </fieldset>
      <div>
        <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? "연결 중…" : "추적 시작"}</button>
      </div>
    </section>
  );
}

function EntryCard({
  e,
  levers,
  ideas,
  onChanged,
  setError,
  onDelete,
}: {
  e: Evaluated;
  levers: Lever[];
  ideas: string[];
  onChanged: () => void;
  setError: (m: string | null) => void;
  onDelete: () => void;
}) {
  const name = new Map(levers.map((l) => [l.id, l.label]));
  const [editing, setEditing] = useState(false);
  return (
    <article className="card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <a className="font-medium hover:underline" href={`https://youtu.be/${e.videoId}`} target="_blank" rel="noreferrer">
            {e.title}
          </a>
          <p className="text-xs text-muted">
            {e.format === "short" ? "쇼츠" : "롱폼"} · {e.publishedAt.slice(0, 10)} 업로드
            {e.ideaTitle ? ` · 아이디어: ${e.ideaTitle}` : ""}
            {e.note ? ` · ${e.note}` : ""}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {e.auto && <span className="rounded border border-line px-1.5 py-0.5 text-xs text-muted">자동 감지</span>}
            {e.levers.map((l) => (
              <span key={l} className="rounded bg-accent/15 px-1.5 py-0.5 text-xs text-accent">{name.get(l) ?? l}</span>
            ))}
            {e.auto && e.levers.length === 0 && <span className="text-xs text-muted">시도한 요소를 체크해 주세요</span>}
            <button className="text-xs text-muted underline hover:text-foreground" onClick={() => setEditing(!editing)}>
              {editing ? "닫기" : "시도한 요소 편집"}
            </button>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-sm font-semibold">{e.verdict}</span>
          <button className="text-xs text-muted hover:text-bad" onClick={onDelete}>추적 중단</button>
        </div>
      </div>
      {editing && (
        <EditEntry
          e={e}
          levers={levers}
          ideas={ideas}
          setError={setError}
          onDone={() => {
            setEditing(false);
            onChanged();
          }}
        />
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-1 pr-3">지표</th>
              {e.checkpoints.map((c) => (
                <th key={c.n} className="px-2">
                  {c.n}일차
                  {c.frozen && (
                    <span className="ml-1 font-normal" title="처음 확정된 시점의 값으로 기록됨">
                      · 기록됨
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => (
              <tr key={m.key} className="border-t border-line">
                <td className="py-1.5 pr-3">{m.label}</td>
                {e.checkpoints.map((c) => {
                  if (!c.ready || !c.cum) {
                    return <td key={c.n} className="px-2 text-xs text-muted">{readyDate(e.publishedAt, c.n)} 이후</td>;
                  }
                  const v = c.cum[m.key];
                  const p = c.pct?.[m.key];
                  return (
                    <td key={c.n} className="px-2">
                      {v === undefined ? "–" : `${fmt(v, m.d)}${m.unit}`}
                      {p !== undefined && <span className={`ml-1.5 text-xs ${tone(p)}`}>상위 {top(p)}%</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function Learned({ rows }: { rows: LeverResult[] }) {
  return (
    <section className="card">
      <h2 className="font-semibold">시도별 결과</h2>
      <p className="mb-2 text-xs text-muted">
        시도한 요소가 노린 지표가 내 과거 영상 대비 어느 위치였는지의 평균입니다. 영상이 3개 미만이면 우연일 수 있어 참고만 하세요.
        이 결과는 다음 AI 추천에 자동 반영됩니다.
      </p>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.lever} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              {r.lever} <span className="text-xs text-muted">→ {r.metricLabel} · 영상 {r.videos}개{r.videos < 3 ? " (표본 적음)" : ""}</span>
            </span>
            <span className={`font-semibold ${tone(r.avgPct)}`}>평균 상위 {top(r.avgPct)}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EditEntry({
  e,
  levers,
  ideas,
  setError,
  onDone,
}: {
  e: Evaluated;
  levers: Lever[];
  ideas: string[];
  setError: (m: string | null) => void;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(e.levers);
  const [idea, setIdea] = useState(e.ideaTitle ?? "");
  const [note, setNote] = useState(e.note === "자동 감지" ? "" : (e.note ?? ""));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/tracking", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: e.videoId, ideaTitle: idea || undefined, levers: picked, note: note || undefined }),
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-3">
      <fieldset className="flex flex-wrap gap-x-5 gap-y-1.5">
        <legend className="mb-1 text-xs text-muted">이 영상에서 시도한 것</legend>
        {levers.map((l) => (
          <label key={l.id} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={picked.includes(l.id)}
              onChange={(ev) => setPicked(ev.target.checked ? [...picked, l.id] : picked.filter((x) => x !== l.id))}
            />
            {l.label}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">어떤 추천 아이디어로 만들었나요?
          <select className="input" value={idea} onChange={(ev) => setIdea(ev.target.value)}>
            <option value="">직접 만든 영상</option>
            {ideas.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">메모
          <input className="input" value={note} onChange={(ev) => setNote(ev.target.value)} />
        </label>
      </div>
      <div>
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
      </div>
    </div>
  );
}

function AutoCollect({
  c,
  busy,
  onRun,
  onRead,
}: {
  c: CollectStatus;
  busy: boolean;
  onRun: () => void;
  onRead: () => void;
}) {
  const when = (iso: string) =>
    new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <section className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">
            자동 수집
            {c.unread > 0 && (
              <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-white">새 알림 {c.unread}</span>
            )}
          </h2>
          <p className="text-xs text-muted">
            {c.autoOn ? "앱이 켜져 있으면 6시간마다 자동으로" : "자동 실행이 꺼져 있습니다. 버튼이나 npm run collect로"} 새 영상을 감지하고, 1·3·7일차 결과가
            확정되면 그 값을 기록합니다.
            {c.lastRunAt ? ` 마지막 수집 ${when(c.lastRunAt)}` : " 아직 수집한 적이 없습니다."}
            {c.lastResult ? ` (새 영상 ${c.lastResult.newVideos}개 · 새 알림 ${c.lastResult.newEvents}개)` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {c.unread > 0 && (
            <button className="btn" onClick={onRead}>
              모두 읽음
            </button>
          )}
          <button className="btn-primary" onClick={onRun} disabled={busy}>
            {busy ? "수집 중…" : "지금 수집"}
          </button>
        </div>
      </div>
      {c.lastError && (
        <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">마지막 수집 실패: {c.lastError}</p>
      )}
      {c.events.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {c.events.slice(0, 8).map((e) => (
            <li key={e.id} className="flex items-start gap-2 px-3 py-2 text-sm">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.read ? "bg-line" : "bg-accent"}`} />
              <div className="min-w-0">
                <p className="truncate font-medium">{e.title}</p>
                <p className="text-xs text-muted">{e.text}</p>
              </div>
              <span className="ml-auto shrink-0 text-xs text-muted">{when(e.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
