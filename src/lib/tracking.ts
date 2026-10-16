import { gget, GoogleApiError } from "./google";
import type { Scored } from "./metrics";
import { loadBaseline, saveBaseline, type BaselineFile, type FrozenResult, type TrackEntry } from "./store";
import { mapPool, sleep } from "./util";

const ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";
const DAY = 86400_000;

/** Checkpoints: cumulative over the first N calendar days (publish day counts as day 1). */
export const CHECKPOINTS = [1, 3, 7] as const;
type N = (typeof CHECKPOINTS)[number];

export type Cum = { views: number; cvr?: number; cta?: number; ret?: number };

// Which metric each tried lever is meant to move.
export const LEVERS = [
  { id: "series_tag", label: "시리즈 태그(제목 끝)", metric: "cvr" },
  { id: "ending_cta", label: "엔딩 CTA 카드", metric: "cvr" },
  { id: "pinned_vote", label: "고정 댓글 투표", metric: "cta" },
  { id: "narrative_title", label: "상황+반응 서사형 제목", metric: "views" },
  { id: "hook_caption", label: "첫 2초 훅 자막", metric: "ret" },
  { id: "sunday", label: "일요일 업로드", metric: "views" },
] as const;
export type Metric = (typeof LEVERS)[number]["metric"];
export const METRIC_LABEL: Record<Metric, string> = {
  views: "조회수",
  cvr: "구독 전환",
  cta: "CTA 반응",
  ret: "지속률",
};

export type DayRow = { offset: number; views: number; subs: number; acts: number; ret: number };

async function fetchDays(videoId: string, publishedAt: string, throughDay: number): Promise<DayRow[] | null> {
  const start = new Date(Date.parse(publishedAt)).toISOString().slice(0, 10);
  const end = new Date(Math.min(Date.now(), Date.parse(start) + throughDay * DAY)).toISOString().slice(0, 10);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await gget<{ columnHeaders: { name: string }[]; rows?: (string | number)[][] }>(ANALYTICS, {
        ids: "channel==MINE",
        startDate: start,
        endDate: end,
        dimensions: "day",
        filters: `video==${videoId}`,
        metrics: "views,averageViewPercentage,subscribersGained,comments,shares",
        sort: "day",
      });
      const h = r.columnHeaders.map((c) => c.name);
      const ix = (n: string) => h.indexOf(n);
      const t0 = Date.parse(start);
      return (r.rows ?? []).map((row) => ({
        offset: Math.round((Date.parse(String(row[ix("day")])) - t0) / DAY),
        views: Number(row[ix("views")]),
        ret: Number(row[ix("averageViewPercentage")]),
        subs: Number(row[ix("subscribersGained")]),
        acts: Number(row[ix("comments")]) + Number(row[ix("shares")]),
      }));
    } catch (e) {
      if (e instanceof GoogleApiError && (e.status === 429 || e.status >= 500)) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      return null;
    }
  }
  return null;
}

export function cumulative(rows: DayRow[], n: number): Cum | null {
  const used = rows.filter((r) => r.offset >= 0 && r.offset < n);
  const views = used.reduce((s, r) => s + r.views, 0);
  if (!used.length) return null;
  const subs = used.reduce((s, r) => s + r.subs, 0);
  const acts = used.reduce((s, r) => s + r.acts, 0);
  // average view % is per-day, so weight by views
  const ret = views ? used.reduce((s, r) => s + r.ret * r.views, 0) / views : undefined;
  return {
    views,
    cvr: views ? (subs / views) * 1000 : undefined,
    cta: views ? (acts / views) * 100 : undefined,
    ret,
  };
}

/** A checkpoint is final once the analytics data for day N has had a day to settle. */
export const isReady = (publishedAt: string, n: number, now = Date.now()) =>
  (now - Date.parse(publishedAt)) / DAY >= n + 1;

// ---------------------------------------------------------------- baseline

export async function buildBaseline(videos: Scored[]): Promise<BaselineFile> {
  const byN: BaselineFile["byN"] = Object.fromEntries(
    CHECKPOINTS.map((n) => [String(n), { views: [], cvr: [], cta: [], ret: [] }]),
  );
  const pool = videos.filter((v) => isReady(v.publishedAt, 7));
  let used = 0;
  await mapPool(pool, 4, async (v) => {
    const rows = await fetchDays(v.id, v.publishedAt, 7);
    if (!rows) return;
    used++;
    for (const n of CHECKPOINTS) {
      const c = cumulative(rows, n);
      if (!c) continue;
      const b = byN[String(n)];
      b.views.push(c.views);
      if (c.cvr !== undefined) b.cvr.push(c.cvr);
      if (c.cta !== undefined) b.cta.push(c.cta);
      if (c.ret !== undefined) b.ret.push(c.ret);
    }
  });
  for (const b of Object.values(byN)) for (const k of Object.keys(b) as (keyof typeof b)[]) b[k].sort((x, y) => x - y);
  const file: BaselineFile = { at: new Date().toISOString(), n: used, byN };
  await saveBaseline(file);
  return file;
}

const q = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);

export type BaselineSummary = {
  at: string;
  n: number;
  byN: Record<string, Record<Metric, { p25: number; p50: number; p75: number; p90: number }>>;
};

export function summarizeBaseline(b: BaselineFile): BaselineSummary {
  const byN: BaselineSummary["byN"] = {};
  for (const [n, m] of Object.entries(b.byN)) {
    const s = (a: number[]) => ({ p25: q(a, 0.25), p50: q(a, 0.5), p75: q(a, 0.75), p90: q(a, 0.9) });
    byN[n] = { views: s(m.views), cvr: s(m.cvr), cta: s(m.cta), ret: s(m.ret) };
  }
  return { at: b.at, n: b.n, byN };
}

/** Share of baseline videos this value beats, 0-100. */
export const rank = (x: number, sorted: number[]) => {
  if (sorted.length < 2) return 50;
  const below = sorted.filter((y) => y < x).length;
  const equal = sorted.filter((y) => y === x).length;
  return Math.round(((below + 0.5 * equal) / sorted.length) * 100);
};

// ---------------------------------------------------------------- evaluation

export type CheckpointResult = {
  n: N;
  ready: boolean;
  /** true when this is the value recorded the first time the checkpoint became final */
  frozen?: boolean;
  cum?: Cum;
  /** percentile vs. my past videos' first-N-days (higher = better) */
  pct?: Partial<Record<Metric, number>>;
};

export type Evaluated = TrackEntry & {
  checkpoints: CheckpointResult[];
  verdict: string;
  latestPct?: Partial<Record<Metric, number>>;
};

export const verdictFor = (p?: number) =>
  p === undefined
    ? "집계 중"
    : p >= 90
      ? "기존 영상 대비 최상위권"
      : p >= 75
        ? "기존 영상보다 확실히 잘 나옴"
        : p >= 50
          ? "평균 이상"
          : p >= 25
            ? "평균 이하"
            : "기존 영상 중 하위권";

const g = globalThis as unknown as { __early?: Map<string, { at: number; rows: DayRow[] | null }> };
const earlyCache = (g.__early ??= new Map());

export async function evaluate(entry: TrackEntry, baseline: BaselineFile | null, fresh = false): Promise<Evaluated> {
  const frozenOf = (n: number) => entry.frozen?.[String(n)];

  // Only hit the Analytics API when some checkpoint is final but not yet recorded.
  const needRows = CHECKPOINTS.some((n) => isReady(entry.publishedAt, n) && !frozenOf(n));
  let rows: DayRow[] | null = null;
  if (needRows) {
    const hit = earlyCache.get(entry.videoId);
    if (!fresh && hit && Date.now() - hit.at < 30 * 60_000) rows = hit.rows;
    else {
      rows = await fetchDays(entry.videoId, entry.publishedAt, 7);
      earlyCache.set(entry.videoId, { at: Date.now(), rows });
    }
  }

  const checkpoints: CheckpointResult[] = CHECKPOINTS.map((n) => {
    const ready = isReady(entry.publishedAt, n);
    const fz = frozenOf(n);
    if (ready && fz) {
      return {
        n,
        ready,
        frozen: true,
        cum: { views: fz.views, cvr: fz.cvr, cta: fz.cta, ret: fz.ret },
        pct: fz.pct as Partial<Record<Metric, number>>,
      };
    }
    const cum = rows ? cumulative(rows, n) : null;
    if (!ready || !cum) return { n, ready, cum: cum ?? undefined };
    const b = baseline?.byN[String(n)];
    const pct: CheckpointResult["pct"] = {};
    if (b) {
      pct.views = rank(cum.views, b.views);
      if (cum.cvr !== undefined) pct.cvr = rank(cum.cvr, b.cvr);
      if (cum.cta !== undefined) pct.cta = rank(cum.cta, b.cta);
      if (cum.ret !== undefined) pct.ret = rank(cum.ret, b.ret);
    }
    return { n, ready, cum, pct };
  });

  const latest = [...checkpoints].reverse().find((c) => c.ready && c.pct && Object.keys(c.pct).length);
  return {
    ...entry,
    checkpoints,
    latestPct: latest?.pct,
    verdict: latest ? `${latest.n}일차 ${verdictFor(latest.pct?.views)}` : "아직 1일차 집계 전",
  };
}

export type LeverResult = {
  lever: string;
  metric: Metric;
  metricLabel: string;
  videos: number;
  /** average percentile of the lever's target metric across tried videos */
  avgPct: number;
};

/** For each lever tried, how did its target metric rank against my history? Needs >=1 video with a ready checkpoint. */
export function learnFromLevers(evals: Evaluated[]): LeverResult[] {
  const out: LeverResult[] = [];
  for (const l of LEVERS) {
    const vals = evals
      .filter((e) => e.levers.includes(l.id))
      .map((e) => e.latestPct?.[l.metric])
      .filter((x): x is number => x !== undefined);
    if (!vals.length) continue;
    out.push({
      lever: l.label,
      metric: l.metric,
      metricLabel: METRIC_LABEL[l.metric],
      videos: vals.length,
      avgPct: Math.round(vals.reduce((s, x) => s + x, 0) / vals.length),
    });
  }
  return out.sort((a, b) => b.avgPct - a.avgPct);
}

export async function getBaseline(videos: Scored[], force = false) {
  const existing = await loadBaseline();
  if (existing && !force && Date.now() - Date.parse(existing.at) < 14 * DAY) return existing;
  return buildBaseline(videos);
}


/** Compact tracked-video results for the recommendation prompt. Percentiles = share of my past videos beaten. */
export async function trackedForAI(entries: TrackEntry[], baseline: BaselineFile | null) {
  const evals = await mapPool(entries, 3, (e) => evaluate(e, baseline));
  const label = new Map<string, string>(LEVERS.map((l) => [l.id, l.label]));
  return {
    videos: evals.map((e) => ({
      title: e.title,
      fromIdea: e.ideaTitle,
      publishedAt: e.publishedAt.slice(0, 10),
      leversTried: e.levers.map((l) => label.get(l) ?? l),
      verdict: e.verdict,
      checkpoints: e.checkpoints
        .filter((c) => c.ready && c.cum)
        .map((c) => ({
          day: c.n,
          views: c.cum!.views,
          subsPer1kViews: c.cum!.cvr && Math.round(c.cum!.cvr * 100) / 100,
          beatsPctOfMyPastVideos: c.pct,
        })),
    })),
    leverSummary: learnFromLevers(evals),
  };
}

/** Snapshot of a final checkpoint, to be stored on the entry. */
export function freezeCheckpoint(c: CheckpointResult, at = new Date().toISOString()): FrozenResult | null {
  if (!c.ready || !c.cum || !c.pct || !Object.keys(c.pct).length) return null;
  return { at, views: c.cum.views, cvr: c.cum.cvr, cta: c.cum.cta, ret: c.cum.ret, pct: c.pct as Record<string, number> };
}

/** One line for the notification feed, e.g. "조회수 2,485 (상위 40%) · 구독 전환 0.21 (상위 55%)". */
export function summarizeCheckpoint(c: CheckpointResult): string {
  const top = (p?: number) => (p === undefined ? "" : ` (상위 ${Math.max(1, 100 - p)}%)`);
  const parts = [`조회수 ${c.cum?.views.toLocaleString("ko-KR") ?? "–"}${top(c.pct?.views)}`];
  if (c.cum?.cvr !== undefined) parts.push(`구독 전환 ${c.cum.cvr.toFixed(2)}${top(c.pct?.cvr)}`);
  if (c.cum?.cta !== undefined) parts.push(`CTA ${c.cum.cta.toFixed(2)}%${top(c.pct?.cta)}`);
  return `${parts.join(" · ")} — ${verdictFor(c.pct?.views)}`;
}
