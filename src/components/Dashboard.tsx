"use client";

import { useCallback, useEffect, useState } from "react";
import type { PatternRow, Scored, ChannelSummary } from "@/lib/metrics";
import type { Candidate, Excluded, Profile } from "@/lib/discover";
import type { LongPack, Pack } from "@/lib/package";
import type { Idea, Recommendation } from "@/lib/recommend";
import type { TrendData, TrendVideo } from "@/lib/trends";
import type { Settings } from "@/lib/store";
import type { ChannelInfo } from "@/lib/youtube";
import { api, fmt, isLongPack } from "./shared";
import OneClick from "./OneClick";
import Studio from "./Studio";
import Tracking from "./Tracking";

type Analysis =
  | { connected: false; configured: boolean }
  | {
      connected: true;
      channel: ChannelInfo;
      notes: string[];
      videos: Scored[];
      patterns: PatternRow[];
      summary: ChannelSummary;
    };

type Tab = "diagnosis" | "trends" | "recommend" | "studio" | "tracking";

const CATEGORIES: [string, string][] = [
  ["", "전체"],
  ["20", "게임"],
  ["22", "인물/블로그"],
  ["24", "엔터테인먼트"],
  ["26", "노하우/스타일"],
  ["27", "교육"],
  ["28", "과학/기술"],
  ["10", "음악"],
  ["17", "스포츠"],
  ["25", "뉴스/정치"],
];

const dur = (s: number) => (s < 90 ? `${s}초` : `${Math.round(s / 60)}분`);

export default function Dashboard() {
  const [data, setData] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("diagnosis");

  const [authError, setAuthError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);

  // Re-read the unread count whenever the tab changes, so a notification that arrived meanwhile (a finished
  // preparation, a new upload) shows up in the tab title without a page reload.
  useEffect(() => {
    api<{ unread: number }>("/api/collect")
      .then((c) => setUnread(c.unread))
      .catch(() => {});
  }, [tab]);

  const load = useCallback((refresh = false) => {
    return api<Analysis>(`/api/analysis${refresh ? "?refresh=1" : ""}`)
      .then((d) => {
        setData(d);
        setAuthError(new URLSearchParams(location.search).get("authError"));
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const reload = (refresh = false) => {
    setLoading(true);
    return load(refresh);
  };

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) return <Shell><p className="text-muted">채널 데이터를 불러오는 중…</p></Shell>;

  if (!data?.connected) {
    return (
      <Shell>
        <Connect configured={data ? data.configured : false} error={error ?? (authError && `Google 로그인 실패: ${authError}`)} />
      </Shell>
    );
  }

  const { channel } = data;
  return (
    <Shell
      header={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{channel.title}</h1>
            <p className="text-sm text-muted">
              구독자 {fmt(channel.subscribers)} · 영상 {fmt(channel.videoCount)}개 · 분석 {data.videos.length}개
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={() => reload(true)} disabled={loading}>
              {loading ? "갱신 중…" : "데이터 새로고침"}
            </button>
            <button
              className="btn"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                setData(null);
                reload();
              }}
            >
              연결 해제
            </button>
          </div>
        </div>
      }
    >
      {error && <Alert>{error}</Alert>}
      {data.notes.map((n) => (
        <Alert key={n} tone="info">{n}</Alert>
      ))}
      <nav className="flex gap-1 border-b border-line">
        {(
          [
            ["diagnosis", "내 채널 진단"],
            ["trends", "트렌드"],
            ["recommend", "AI 추천"],
            ["studio", "영상 제작"],
            ["tracking", unread > 0 ? `성과 추적 (${unread})` : "성과 추적"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === k ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "diagnosis" && <Diagnosis a={data} />}
      {tab === "trends" && <Trends />}
      {tab === "recommend" && <Recommend />}
      {tab === "studio" && <Studio />}
      {tab === "tracking" && <Tracking onUnread={setUnread} />}
    </Shell>
  );
}

function Shell({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-8 sm:px-6">
      {header ?? <h1 className="text-xl font-semibold">YT Growth Coach</h1>}
      {children}
    </main>
  );
}

function Alert({ children, tone = "error" }: { children: React.ReactNode; tone?: "error" | "info" }) {
  return (
    <div
      className={`rounded-md border px-3 py-2 text-sm ${
        tone === "error" ? "border-bad/40 bg-bad/10 text-bad" : "border-line bg-card text-muted"
      }`}
    >
      {children}
    </div>
  );
}

function Connect({ configured, error }: { configured: boolean; error?: string | null }) {
  return (
    <section className="card flex flex-col gap-4">
      <h2 className="text-lg font-semibold">내 유튜브 채널 연결</h2>
      {error && <Alert>{error}</Alert>}
      {configured ? (
        <>
          <p className="text-sm text-muted">
            읽기 전용 권한(YouTube 데이터 + Analytics)만 요청합니다. 토큰은 이 컴퓨터의 <code>.data/</code> 폴더에만 저장됩니다.
          </p>
          <a href="/api/auth/login" className="btn-primary w-fit">Google 계정으로 연결</a>
        </>
      ) : (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Google Cloud Console에서 프로젝트를 만들고 <b>YouTube Data API v3</b>와 <b>YouTube Analytics API</b>를 사용 설정합니다.</li>
          <li>OAuth 동의 화면(외부, 테스트 모드)에서 내 구글 계정을 <b>테스트 사용자</b>로 추가합니다.</li>
          <li>사용자 인증 정보 → OAuth 클라이언트 ID(웹 애플리케이션), 승인된 리디렉션 URI에 <code>http://localhost:3000/api/auth/callback</code>.</li>
          <li><code>.env.example</code>을 <code>.env.local</code>로 복사해 키를 채우고 개발 서버를 다시 시작합니다.</li>
        </ol>
      )}
    </section>
  );
}

// ---------------- Diagnosis ----------------

function Diagnosis({ a }: { a: Extract<Analysis, { connected: true }> }) {
  const [format, setFormat] = useState<"all" | "long" | "short">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<"score" | "views" | "cvr">("score");
  const key = (v: Scored) =>
    sort === "views" ? v.views : sort === "cvr" ? (v.cvrPer1k ?? -1) : (v.score ?? -1);
  const rows = a.videos
    .filter((v) => format === "all" || v.format === format)
    .sort((x, y) => key(y) - key(x));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {(["long", "short"] as const).map((f) => {
          const s = a.summary.byFormat[f];
          return (
            <div key={f} className="card">
              <p className="text-sm text-muted">
                {f === "long" ? "롱폼" : "쇼츠"} · {s.n ? `평가 ${s.n}개` : "평가할 영상 없음"}
              </p>
              <dl className="mt-2 grid grid-cols-3 gap-2">
                <Stat label="일평균 조회수(중앙값)" value={s.n ? fmt(s.medianViewsPerDay) : "–"} />
                <Stat label="평균 시청 지속률" value={s.medianRetention ? `${s.medianRetention}%` : "–"} />
                <Stat label="구독 전환(1천 조회당)" value={s.n ? fmt(s.medianCvr, 2) : "–"} />
              </dl>
            </div>
          );
        })}
      </div>

      {a.patterns.length > 0 && (
        <section className="card">
          <h2 className="mb-1 font-semibold">내 채널에서 잘 되는 패턴</h2>
          <p className="mb-3 text-xs text-muted">
            점수 중앙값이 전체 대비 얼마나 높은지(lift). 그룹당 3개 이상, 단순 상관이며 인과가 아닙니다.
          </p>
          <ul className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
            {a.patterns.slice(0, 10).map((p) => (
              <li key={p.feature + p.bucket} className="flex items-center justify-between gap-3 text-sm">
                <span>{p.bucket} <span className="text-muted">({p.n}개)</span></span>
                <span className={p.lift >= 0 ? "text-good" : "text-bad"}>
                  {p.lift >= 0 ? "+" : ""}{p.lift}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card overflow-x-auto p-0">
        <div className="flex items-center justify-between p-4 pb-2">
          <h2 className="font-semibold">영상별 품질 점수 · 회고</h2>
          <div className="flex gap-2">
            <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="score">품질 점수순</option>
              <option value="views">총 조회수순</option>
              <option value="cvr">구독 전환순</option>
            </select>
            <select className="input w-auto" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
              <option value="all">전체</option>
              <option value="long">롱폼</option>
              <option value="short">쇼츠</option>
            </select>
          </div>
        </div>
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2">영상</th>
              <th className="px-2">점수</th>
              <th className="px-2 text-right">총 조회 · 일평균</th>
              <th className="px-2 text-right">지속률</th>
              <th className="px-2 text-right">CTR</th>
              <th className="px-2 text-right">CTA 반응</th>
              <th className="px-4 text-right">CVR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <VideoRow key={v.id} v={v} open={open === v.id} toggle={() => setOpen(open === v.id ? null : v.id)} />
            ))}
          </tbody>
        </table>
        <p className="p-4 pt-2 text-xs text-muted">
          점수 = 같은 포맷 안에서의 백분위(조회 속도 20 · 지속률 30 · CTR 15 · 참여 15 · 구독 전환 20, 없는 지표는 제외). 업로드 7일 미만 영상은 점수를 매기지 않습니다. CVR = 1천 조회당 신규 구독자, CTA 반응 = (댓글+공유)/조회수. 쇼츠의 지속률이 100%를 넘는 것은 반복 재생이 포함되기 때문입니다.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}

function VideoRow({ v, open, toggle }: { v: Scored; open: boolean; toggle: () => void }) {
  const tone = v.score === null ? "text-muted" : v.score >= 66 ? "text-good" : v.score <= 33 ? "text-bad" : "";
  return (
    <>
      <tr className="cursor-pointer border-t border-line hover:bg-card" onClick={toggle}>
        <td className="max-w-[340px] px-4 py-2">
          <div className="truncate font-medium">{v.title}</div>
          <div className="text-xs text-muted">
            {v.format === "short" ? "쇼츠" : "롱폼"} · {dur(v.durationSec)} · {v.publishedAt.slice(0, 10)}
          </div>
        </td>
        <td className={`px-2 font-semibold ${tone}`}>{v.score ?? "집계 중"}</td>
        <td className="px-2 text-right">
          {fmt(v.views)} <span className="text-muted">· {fmt(v.viewsPerDay)}</span>
        </td>
        <td className="px-2 text-right">{v.avgViewPct !== undefined ? `${fmt(v.avgViewPct, 1)}%` : "–"}</td>
        <td className="px-2 text-right">{v.ctr !== undefined ? `${fmt(v.ctr, 1)}%` : "–"}</td>
        <td className="px-2 text-right">{v.ctaPct !== undefined ? `${fmt(v.ctaPct, 2)}%` : "–"}</td>
        <td className="px-4 text-right">{fmt(v.cvrPer1k, 2)}</td>
      </tr>
      {open && (
        <tr className="bg-card">
          <td colSpan={7} className="px-4 py-3 text-sm">
            {v.score === null ? (
              <p className="text-muted">업로드 후 7일이 지나면 회고가 생성됩니다.</p>
            ) : v.retro.good.length + v.retro.bad.length === 0 ? (
              <p className="text-muted">채널 중앙값과 비슷한 평범한 성과입니다.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <List title="잘 된 점" tone="good" items={v.retro.good} />
                <List title="아쉬운 점" tone="bad" items={v.retro.bad} />
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function List({ title, items, tone }: { title: string; items: string[]; tone: "good" | "bad" }) {
  if (!items.length) return <div />;
  return (
    <div>
      <h3 className={`mb-1 text-xs font-semibold ${tone === "good" ? "text-good" : "text-bad"}`}>{title}</h3>
      <ul className="list-disc space-y-1 pl-4">
        {items.map((i) => <li key={i}>{i}</li>)}
      </ul>
    </div>
  );
}

// ---------------- Trends ----------------

function Trends() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [trends, setTrends] = useState<TrendData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Settings>("/api/settings").then(setSettings).catch((e) => setError(e.message));
  }, []);

  const run = async () => {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      setTrends(await api<TrendData>("/api/trends?refresh=1"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

  const save = async (next: Settings) => {
    setSettings(next);
    try {
      await api("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {error && <Alert>{error}</Alert>}
      {settings && <Discover settings={settings} save={save} />}
      {settings && (
        <section key={settings.competitors.join() + settings.keywords.join()} className="card grid gap-3 sm:grid-cols-2">
          <label className="field">국가 코드
            <input className="input" value={settings.regionCode} maxLength={2}
              onChange={(e) => setSettings({ ...settings, regionCode: e.target.value.toUpperCase() })} />
          </label>
          <label className="field">카테고리
            <select className="input" value={settings.categoryId}
              onChange={(e) => setSettings({ ...settings, categoryId: e.target.value })}>
              {CATEGORIES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="field">경쟁·벤치마크 채널 (@핸들, 쉼표로 구분, 최대 8개)
            <input className="input" placeholder="@channel1, @channel2" defaultValue={settings.competitors.join(", ")}
              onBlur={(e) => setSettings({ ...settings, competitors: list(e.target.value).slice(0, 8) })} />
          </label>
          <label className="field">관심 키워드 (최근 30일 인기 영상 검색, 최대 5개)
            <input className="input" placeholder="브이로그, 숏폼 편집" defaultValue={settings.keywords.join(", ")}
              onBlur={(e) => setSettings({ ...settings, keywords: list(e.target.value).slice(0, 5) })} />
          </label>
          <div className="sm:col-span-2">
            <button className="btn-primary" onClick={run} disabled={busy}>
              {busy ? "수집 중…" : "트렌드 수집"}
            </button>
            <span className="ml-3 text-xs text-muted">키워드 1개당 API 할당량 약 100 소모 (일일 10,000)</span>
          </div>
        </section>
      )}
      {trends && (
        <>
          {trends.notes.map((n) => <Alert key={n} tone="info">{n}</Alert>)}
          <TrendList title="지금 인기 급상승" rows={trends.popular.slice(0, 15)} />
          {trends.competitors.map((c) => (
            <TrendList
              key={c.channel}
              title={`${c.channel} — 평소 대비 터진 영상`}
              sub={`구독자 ${fmt(c.subscribers)} · 일평균 조회 중앙값 ${fmt(c.medianViewsPerDay)}`}
              rows={c.hits}
              empty="최근 영상 중 평소의 1.5배 이상 터진 영상이 없습니다."
            />
          ))}
          {trends.keywords.map((k) => (
            <TrendList key={k.keyword} title={`키워드 “${k.keyword}” 최근 30일 상위`} rows={k.videos} />
          ))}
        </>
      )}
    </div>
  );
}

function Discover({ settings, save }: { settings: Settings; save: (s: Settings) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<{
    profile: Profile;
    candidates: Candidate[];
    excluded: Excluded[];
    notes: string[];
    stats: { pool: number; checked: number };
  } | null>(null);

  const run = async (refresh = false) => {
    setBusy(true);
    setError(null);
    try {
      setRes(
        await api("/api/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const added = (id: string) => settings.competitors.includes(id);
  const toggle = (c: Candidate) =>
    save({
      ...settings,
      competitors: added(c.id)
        ? settings.competitors.filter((x) => x !== c.id)
        : [...settings.competitors, c.id].slice(0, 8),
    });
  const addKeywords = () =>
    res && save({ ...settings, keywords: res.profile.search_queries.slice(0, 5) });

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">내 채널 파악 · 비슷한 채널 찾기</h2>
          <p className="text-xs text-muted">
            내 영상의 제목·해시태그로 채널 성격을 파악하고, 후보 채널의 최근 영상 30개를 직접 확인해 같은 소재를 꾸준히 다루는 채널만 남깁니다. (API 할당량 약 700 소모)
          </p>
        </div>
        <button className="btn-primary" onClick={() => run(!!res)} disabled={busy}>
          {busy ? "분석·검증 중… (1~2분)" : res ? "다시 찾기" : "비슷한 채널 찾기"}
        </button>
      </div>
      {error && <Alert>{error}</Alert>}
      {res && (
        <>
          <div className="rounded-md border border-line p-3 text-sm">
            <p className="font-medium">{res.profile.niche}</p>
            <p className="mt-1 text-muted">{res.profile.summary}</p>
            <ul className="mt-2 list-disc space-y-0.5 pl-5">
              {res.profile.content_formats.map((f) => <li key={f}>{f}</li>)}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted">검색에 쓴 키워드</span>
              {res.profile.search_queries.map((q) => (
                <span key={q} className="rounded bg-accent/15 px-2 py-0.5 text-accent">{q}</span>
              ))}
              <button className="btn" onClick={addKeywords}>관심 키워드로 저장</button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted">소재 판별에 쓴 핵심어</span>
              {res.profile.core_terms.map((t) => (
                <span key={t} className="rounded border border-line px-2 py-0.5">{t}</span>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted">
            검색으로 찾은 {res.stats.pool}개 채널 중 최근 영상을 직접 확인해 {res.candidates.length}개만 남겼습니다.
            제외된 {res.excluded.length}개는 아래에서 이유를 볼 수 있습니다.
          </p>
          {res.notes.map((n) => <Alert key={n} tone="info">{n}</Alert>)}
          {res.candidates.length === 0 ? (
            <p className="text-sm text-muted">조건에 맞는 채널을 찾지 못했습니다.</p>
          ) : (
            <ul className="divide-y divide-line">
              {res.candidates.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-4 py-3 text-sm">
                  <div className="min-w-0">
                    <a
                      className="font-medium hover:underline"
                      href={`https://www.youtube.com/channel/${c.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {c.title}
                    </a>
                    <span
                      className={`ml-2 rounded px-1.5 py-0.5 text-xs ${
                        c.verdict === "dedicated" ? "bg-good/15 text-good" : "bg-line text-muted"
                      }`}
                    >
                      {c.verdict === "dedicated" ? "전용 채널" : "부분 일치"} · 관련도 {c.relevance}
                    </span>
                    <p className="text-xs text-muted">
                      구독자 {fmt(c.subscribers)}
                      {c.sizeRatio ? ` (내 채널의 ${c.sizeRatio}배)` : ""} · 최근 영상 제목에 핵심어 {c.titleMatchPct}%
                      {c.hashtagOnlyPct > 0 ? ` · 해시태그에만 ${c.hashtagOnlyPct}%` : ""} · 쇼츠 {c.shortsPct}% · 90일 업로드{" "}
                      {c.uploads90d}개 · 영상 중앙 조회수 {fmt(c.medianViews)}
                    </p>
                    <p className="mt-0.5">{c.reason}</p>
                    <p className="truncate text-xs text-muted">최근: {c.sampleTitles.join(" / ")}</p>
                  </div>
                  <button className={`shrink-0 ${added(c.id) ? "btn" : "btn-primary"}`} onClick={() => toggle(c)}>
                    {added(c.id) ? "추가됨 ✓" : "경쟁 채널에 추가"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">
            추가한 채널은 아래 “트렌드 수집”을 누르면 최근 영상 중 평소보다 터진 영상을 분석합니다. 경쟁 채널은 최대 8개입니다.
          </p>
          {res.excluded.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted">제외된 채널 {res.excluded.length}개와 이유 보기</summary>
              <ul className="mt-2 space-y-1">
                {res.excluded.map((x) => (
                  <li key={x.id} className="text-xs">
                    <a className="font-medium hover:underline" href={`https://www.youtube.com/channel/${x.id}`} target="_blank" rel="noreferrer">
                      {x.title}
                    </a>
                    <span className="text-muted"> (구독자 {fmt(x.subscribers)}) — {x.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function TrendList({ title, sub, rows, empty }: { title: string; sub?: string; rows: TrendVideo[]; empty?: string }) {
  return (
    <section className="card">
      <h2 className="font-semibold">{title}</h2>
      {sub && <p className="text-xs text-muted">{sub}</p>}
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{empty ?? "데이터 없음"}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {rows.map((v) => (
            <li key={v.id} className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
              <a className="truncate hover:underline" href={`https://youtu.be/${v.id}`} target="_blank" rel="noreferrer">
                {v.title}
              </a>
              <span className="shrink-0 text-xs text-muted">
                {v.channelTitle} · {v.format === "short" ? "쇼츠" : dur(v.durationSec)} · 일 {fmt(v.viewsPerDay)}회
                {v.outlier ? ` · ${v.outlier}배` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------- Recommend ----------------

const FORMAT_LABEL = { long: "롱폼", short: "쇼츠", reels: "릴스" } as const;
const BASIS_LABEL = { my_channel: "내 채널 데이터", trend: "트렌드", competitor: "경쟁 채널", mixed: "복합" } as const;
const KIND = {
  fix: { label: "고치기", cls: "bg-bad/15 text-bad" },
  stop: { label: "중단", cls: "bg-bad/15 text-bad" },
  keep: { label: "계속", cls: "bg-good/15 text-good" },
} as const;

type Saved = { at: string; goal: string; result: Recommendation };
type SavedPack = { at: string; idea: Idea; pack: Pack | LongPack };

function Recommend() {
  const [goal, setGoal] = useState("");
  const [useTrends, setUseTrends] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [packs, setPacks] = useState<Record<string, SavedPack>>({});

  // Loads the saved recommendation and packages; also called after a one-click preparation finishes.
  const loadSaved = useCallback(() => {
    api<Saved | null>("/api/recommend")
      .then((s) => s && s.result && "headline" in s.result && setSaved(s))
      .catch(() => {});
    api<Record<string, SavedPack>>("/api/package").then(setPacks).catch(() => {});
  }, []);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setSaved(
        await api<Saved>("/api/recommend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goal, useTrends }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rec = saved?.result;
  const actions = rec ? [...rec.actions].sort((a, b) => a.priority - b.priority) : [];

  return (
    <div className="flex flex-col gap-5">
      <OneClick goal={goal} onDone={loadSaved} />
      <section className="card flex flex-col gap-3">
        <label className="field">이번 목표 (선택)
          <input className="input" placeholder="예: 구독자 1,000명 달성, 쇼츠로 신규 유입" value={goal}
            onChange={(e) => setGoal(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={useTrends} onChange={(e) => setUseTrends(e.target.checked)} />
          트렌드 탭에서 수집한 설정으로 인기 영상·경쟁 채널 데이터 포함
        </label>
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={run} disabled={busy}>
            {busy ? "분석 중… (최대 1~2분)" : saved ? "다시 추천받기" : "다음 영상 추천받기"}
          </button>
          {saved && !busy && (
            <span className="text-xs text-muted">
              마지막 결과 {new Date(saved.at).toLocaleString("ko-KR")}
              {saved.goal ? ` · 목표: ${saved.goal}` : ""}
            </span>
          )}
        </div>
      </section>
      {error && <Alert>{error}</Alert>}
      {rec && (
        <>
          <section className="card flex flex-col gap-4">
            <p className="text-lg font-semibold leading-snug">{rec.headline}</p>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {rec.key_findings.map((k) => (
                <div key={k.label} className="rounded-md border border-line p-3">
                  <dt className="text-xs text-muted">{k.label}</dt>
                  <dd className="mt-0.5 text-lg font-semibold">{k.value}</dd>
                  <p className="text-xs text-muted">{k.note}</p>
                </div>
              ))}
            </dl>
          </section>

          <section className="card flex flex-col gap-4">
            <h2 className="font-semibold">지금 할 일</h2>
            {([1, 2, 3] as const).map((tier) => {
              const items = actions.filter((a) => Math.min(3, Math.max(1, Math.round(a.priority))) === tier);
              if (!items.length) return null;
              return (
                <div key={tier}>
                  <h3 className="mb-1 text-xs font-semibold text-muted">
                    {tier === 1 ? "1순위 · 먼저" : tier === 2 ? "2순위 · 이어서" : "3순위 · 여유 있을 때"}
                  </h3>
                  <ul className="divide-y divide-line rounded-md border border-line">
                    {items.map((a, i) => (
                      <li key={i} className="px-3 py-2.5">
                        <p className="font-medium">
                          <span className={`mr-2 rounded px-1.5 py-0.5 text-xs ${KIND[a.kind].cls}`}>{KIND[a.kind].label}</span>
                          {a.title}
                        </p>
                        <p className="mt-0.5 text-sm">{a.how}</p>
                        <p className="mt-0.5 text-xs text-muted">근거: {a.evidence}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>

          <section>
            <h2 className="mb-2 font-semibold">영상 아이디어</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {rec.ideas.map((idea, i) => (
                <article key={i} className="card flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="rounded bg-accent/15 px-2 py-0.5 font-medium text-accent">
                      {i + 1}. {FORMAT_LABEL[idea.format]}
                    </span>
                    <span className="text-muted">{BASIS_LABEL[idea.basedOn]} · 확신 {idea.confidence}</span>
                  </div>
                  <h3 className="font-semibold">{idea.title}</h3>
                  <p className="text-sm"><b>훅</b> {idea.hook}</p>
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted">구성 · CTA · 근거 보기</summary>
                    <ol className="mt-2 list-decimal space-y-0.5 pl-5">
                      {idea.outline.map((o, j) => <li key={j}>{o}</li>)}
                    </ol>
                    <p className="mt-2"><b>CTA</b> {idea.cta}</p>
                    <p className="mt-1 text-xs text-muted">근거: {idea.why}</p>
                  </details>
                  <PackagePanel
                    idea={idea}
                    saved={packs[idea.title]}
                    onSaved={(p) => setPacks((prev) => ({ ...prev, [idea.title]: p }))}
                  />
                </article>
              ))}
            </div>
          </section>

          {rec.data_gaps.length > 0 && (
            <Alert tone="info">
              <b>정확도를 높이려면</b>
              <ul className="list-disc pl-5">{rec.data_gaps.map((g) => <li key={g}>{g}</li>)}</ul>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}

// ---------------- Production package ----------------

function CopyButton({ text, label = "복사" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="rounded border border-line px-1.5 py-0.5 text-xs text-muted hover:text-foreground"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {done ? "복사됨" : label}
    </button>
  );
}

const NL = "\n";

/** "0:00 오프닝" lines, ready to paste into a YouTube description (needs 3+ chapters starting at 0:00). */
const chapterBlock = (p: LongPack) => p.chapters.map((c) => `${c.time} ${c.title}`).join(NL);
const longDescription = (p: LongPack) => `${p.description}${NL}${NL}${chapterBlock(p)}`;

function packToMarkdown(idea: Idea, p: Pack | LongPack) {
  const section = (title: string, body: string) => `## ${title}${NL}${body}`;
  if (isLongPack(p)) {
    return [
      `# ${idea.title}`,
      section("권장 길이", `${p.target_length_min}분`),
      section("제목 후보", p.titles.map((t, i) => `${i + 1}. ${t.text} (${t.style})`).join(NL)),
      section("썸네일 안", p.thumbnails.map((t, i) => `${i + 1}. 글씨: ${t.overlay_text} / 장면: ${t.visual}`).join(NL)),
      section("오프닝 자막", p.hook_caption),
      section("오프닝 대본", p.opening_script),
      section("챕터", p.chapters.map((c) => `- ${c.time} ${c.title} — ${c.purpose}`).join(NL)),
      section("이탈 방지 장치", p.retention_tactics.map((t) => `- ${t.at} ${t.tactic}`).join(NL)),
      section("중간 CTA", p.midroll_cta),
      section("엔딩 화면 문구", p.ending_cta),
      section("고정 댓글", p.pinned_comment),
      section("설명", longDescription(p)),
      section("해시태그", p.hashtags.join(" ")),
      section("업로드", p.upload_slot),
      section("확인할 것", p.fill_in.map((f) => `- [ ] ${f}`).join(NL)),
    ].join(NL + NL);
  }
  return [
    `# ${idea.title}`,
    section("제목 후보", p.titles.map((t, i) => `${i + 1}. ${t.text} (${t.style})`).join(NL)),
    section("첫 2초 자막", p.hook_caption),
    section(
      "컷 구성",
      p.shot_plan
        .map((r) => `- ${r.time} | ${r.pick}${r.caption ? ` | 자막: ${r.caption}` : ""} | ${r.edit_tip}`)
        .join(NL),
    ),
    section("엔딩 CTA", p.ending_cta),
    section("고정 댓글", p.pinned_comment),
    section("설명", p.description),
    section("해시태그", p.hashtags.join(" ")),
    section("업로드", p.upload_slot),
    section("확인할 것", p.fill_in.map((f) => `- [ ] ${f}`).join(NL)),
  ].join(NL + NL);
}

function PackagePanel({
  idea,
  saved,
  onSaved,
}: {
  idea: Idea;
  saved?: SavedPack;
  onSaved: (p: SavedPack) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api<SavedPack>("/api/package", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idea }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const p = saved?.pack;
  return (
    <div className="mt-1 border-t border-line pt-3">
      {error && <Alert>{error}</Alert>}
      {!p ? (
        <button className="btn w-full" onClick={make} disabled={busy}>
          {busy ? "패키지 만드는 중… (30초~1분)" : "제작 패키지 만들기"}
        </button>
      ) : (
        <details className="text-sm" open>
          <summary className="flex cursor-pointer items-center justify-between gap-2 font-medium">
            <span>제작 패키지</span>
            <span className="flex gap-1.5" onClick={(e) => e.preventDefault()}>
              <CopyButton text={packToMarkdown(idea, p)} label="전체 복사" />
              <button type="button" className="rounded border border-line px-1.5 py-0.5 text-xs text-muted hover:text-foreground" onClick={make} disabled={busy}>
                {busy ? "만드는 중…" : "다시 만들기"}
              </button>
            </span>
          </summary>
          {isLongPack(p) ? <LongBody p={p} /> : <ShortBody p={p} />}
        </details>
      )}
    </div>
  );
}

function Field({ label, copy, children }: { label: string; copy?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between">
        <h4 className="text-xs font-semibold text-muted">{label}</h4>
        {copy && <CopyButton text={copy} />}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ShortBody({ p }: { p: Pack }) {
  return (
    <div className="mt-3 flex flex-col gap-3">
            <Field label="제목 후보">
              <ul className="space-y-1">
                {p.titles.map((t) => (
                  <li key={t.text} className="flex items-start justify-between gap-2">
                    <span>
                      {t.text} <span className="text-xs text-muted">· {t.style}</span>
                    </span>
                    <CopyButton text={t.text} />
                  </li>
                ))}
              </ul>
            </Field>
            <Field label="첫 2초 자막" copy={p.hook_caption}>{p.hook_caption}</Field>
            <Field label="컷 구성">
              <ul className="space-y-1.5">
                {p.shot_plan.map((r, i) => (
                  <li key={i} className="rounded border border-line p-2 text-xs">
                    <p><b>{r.time}</b> {r.pick}</p>
                    {r.caption && <p className="text-muted">자막: {r.caption}</p>}
                    <p className="text-muted">팁: {r.edit_tip}</p>
                  </li>
                ))}
              </ul>
            </Field>
            <Field label="엔딩 CTA 카드" copy={p.ending_cta}>{p.ending_cta}</Field>
            <Field label="고정 댓글" copy={p.pinned_comment}><span className="whitespace-pre-wrap">{p.pinned_comment}</span></Field>
            <Field label="설명" copy={p.description}><span className="whitespace-pre-wrap">{p.description}</span></Field>
            <Field label="해시태그" copy={p.hashtags.join(" ")}>{p.hashtags.join(" ")}</Field>
            <Field label="업로드">{p.upload_slot}</Field>
            <Field label="클립 확인 후 채울 것">
              <ul className="list-disc space-y-0.5 pl-5">{p.fill_in.map((f) => <li key={f}>{f}</li>)}</ul>
            </Field>
    </div>
  );
}

function LongBody({ p }: { p: LongPack }) {
  return (
    <div className="mt-3 flex flex-col gap-3">
      <Field label="권장 길이">{p.target_length_min}분</Field>
      <Field label="제목 후보">
        <ul className="space-y-1">
          {p.titles.map((t) => (
            <li key={t.text} className="flex items-start justify-between gap-2">
              <span>
                {t.text} <span className="text-xs text-muted">· {t.style}</span>
              </span>
              <CopyButton text={t.text} />
            </li>
          ))}
        </ul>
      </Field>
      <Field label="썸네일 안">
        <ul className="space-y-1.5">
          {p.thumbnails.map((t, i) => (
            <li key={i} className="flex items-start justify-between gap-2 rounded border border-line p-2 text-xs">
              <span>
                <b>“{t.overlay_text}”</b> <span className="text-muted">{t.visual}</span>
              </span>
              <CopyButton text={t.overlay_text} />
            </li>
          ))}
        </ul>
      </Field>
      <Field label="오프닝 자막 (첫 5초)" copy={p.hook_caption}>{p.hook_caption}</Field>
      <Field label="오프닝 대본 (처음 30초)" copy={p.opening_script}><span className="whitespace-pre-wrap">{p.opening_script}</span></Field>
      <Field label="챕터 (시간은 실제 편집 길이에 맞게 고치세요)" copy={chapterBlock(p)}>
        <ul className="space-y-1">
          {p.chapters.map((c, i) => (
            <li key={i} className="text-xs">
              <b className="tabular-nums">{c.time}</b> {c.title} <span className="text-muted">— {c.purpose}</span>
            </li>
          ))}
        </ul>
      </Field>
      <Field label="이탈 방지 장치">
        <ul className="space-y-1">
          {p.retention_tactics.map((t, i) => (
            <li key={i} className="text-xs">
              <b className="tabular-nums">{t.at}</b> {t.tactic}
            </li>
          ))}
        </ul>
      </Field>
      <Field label="중간 CTA" copy={p.midroll_cta}>{p.midroll_cta}</Field>
      <Field label="엔딩 화면 문구" copy={p.ending_cta}>{p.ending_cta}</Field>
      <Field label="고정 댓글" copy={p.pinned_comment}><span className="whitespace-pre-wrap">{p.pinned_comment}</span></Field>
      <Field label="설명 (챕터 목록 포함)" copy={longDescription(p)}><span className="whitespace-pre-wrap">{longDescription(p)}</span></Field>
      <Field label="해시태그" copy={p.hashtags.join(" ")}>{p.hashtags.join(" ")}</Field>
      <Field label="업로드">{p.upload_slot}</Field>
      <Field label="영상 만든 뒤 채울 것">
        <ul className="list-disc space-y-0.5 pl-5">{p.fill_in.map((f) => <li key={f}>{f}</li>)}</ul>
      </Field>
    </div>
  );
}
