import type { VideoStat } from "../shared/youtube";

export const MIN_AGE_DAYS = 7; // younger videos haven't settled; excluded from scoring

export type Scored = VideoStat & {
  ageDays: number;
  viewsPerDay: number;
  engagementPct: number; // (likes+comments+shares)/views
  ctaPct?: number; // (comments+shares)/views  -> did viewers act on the CTA beyond a like
  cvrPer1k?: number; // subscribers gained per 1,000 views
  score: number | null; // 0-100 percentile blend within the same format
  parts: Partial<Record<"reach" | "retention" | "ctr" | "engagement" | "cvr", number>>;
  retro: { good: string[]; bad: string[] };
};

const WEIGHTS = { reach: 0.2, retention: 0.3, ctr: 0.15, engagement: 0.15, cvr: 0.2 } as const;

export const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Percentile rank of x within xs, 0-100. */
const pct = (x: number, xs: number[]) => {
  if (xs.length < 2) return 50;
  const below = xs.filter((y) => y < x).length;
  const equal = xs.filter((y) => y === x).length;
  return ((below + 0.5 * equal) / xs.length) * 100;
};

export function scoreVideos(videos: VideoStat[], now = Date.now()): Scored[] {
  const base: Scored[] = videos.map((v) => {
    const ageDays = Math.max(1, (now - Date.parse(v.publishedAt)) / 86400_000);
    const acts = v.likes + v.comments + (v.shares ?? 0);
    return {
      ...v,
      ageDays,
      viewsPerDay: v.views / ageDays,
      engagementPct: v.views ? (acts / v.views) * 100 : 0,
      ctaPct: v.shares !== undefined && v.views ? ((v.comments + v.shares) / v.views) * 100 : undefined,
      cvrPer1k: v.subsGained !== undefined && v.views ? (v.subsGained / v.views) * 1000 : undefined,
      score: null,
      parts: {},
      retro: { good: [], bad: [] },
    };
  });

  for (const format of ["short", "long"] as const) {
    const all = base.filter((v) => v.format === format);
    const settled = all.filter((v) => v.ageDays >= MIN_AGE_DAYS);
    if (settled.length < 3) continue; // not enough to rank meaningfully

    const col = (f: (v: Scored) => number | undefined) =>
      settled.map(f).filter((x): x is number => x !== undefined);
    const dist = {
      reach: col((v) => v.viewsPerDay),
      retention: col((v) => v.avgViewPct),
      ctr: col((v) => v.ctr),
      engagement: col((v) => v.engagementPct),
      cvr: col((v) => v.cvrPer1k),
    };
    const med = {
      retention: median(dist.retention),
      ctr: median(dist.ctr),
      engagement: median(dist.engagement),
      cvr: median(dist.cvr),
      cta: median(col((v) => v.ctaPct)),
      reach: median(dist.reach),
    };

    for (const v of settled) {
      const parts: Scored["parts"] = { reach: pct(v.viewsPerDay, dist.reach) };
      if (v.avgViewPct !== undefined) parts.retention = pct(v.avgViewPct, dist.retention);
      if (v.ctr !== undefined) parts.ctr = pct(v.ctr, dist.ctr);
      parts.engagement = pct(v.engagementPct, dist.engagement);
      if (v.cvrPer1k !== undefined) parts.cvr = pct(v.cvrPer1k, dist.cvr);

      let wsum = 0;
      let acc = 0;
      for (const k of Object.keys(parts) as (keyof typeof WEIGHTS)[]) {
        acc += parts[k]! * WEIGHTS[k];
        wsum += WEIGHTS[k];
      }
      v.parts = parts;
      v.score = Math.round(acc / wsum);
      v.retro = retrospective(v, med);
    }
  }
  return base;
}

type Med = { retention: number; ctr: number; engagement: number; cvr: number; cta: number; reach: number };

function retrospective(v: Scored, m: Med) {
  const good: string[] = [];
  const bad: string[] = [];
  const cmp = (
    val: number | undefined,
    med: number,
    label: string,
    fmt: (n: number) => string,
    hi = 1.25,
    lo = 0.75,
  ) => {
    if (val === undefined || !med) return;
    const r = val / med;
    if (r >= hi) good.push(`${label} ${fmt(val)} (채널 중앙값 ${fmt(med)}의 ${r.toFixed(1)}배)`);
    else if (r <= lo) bad.push(`${label} ${fmt(val)} (채널 중앙값 ${fmt(med)}의 ${r.toFixed(1)}배)`);
  };
  const p1 = (n: number) => n.toFixed(1);
  const p2 = (n: number) => n.toFixed(2);

  cmp(v.viewsPerDay, m.reach, "일평균 조회수", (n) => Math.round(n).toLocaleString(), 1.5, 0.6);
  cmp(v.avgViewPct, m.retention, "평균 시청 지속률", (n) => `${p1(n)}%`);
  cmp(v.ctr, m.ctr, "썸네일 CTR", (n) => `${p1(n)}%`);
  cmp(v.ctaPct, m.cta, "CTA 반응(댓글+공유)", (n) => `${p2(n)}%`, 1.4, 0.6);
  cmp(v.cvrPer1k, m.cvr, "구독 전환(1천 조회당)", p2, 1.4, 0.6);

  // Hook diagnosis: decent click-through but weak retention = promise not delivered / slow start.
  if (v.ctr !== undefined && v.avgViewPct !== undefined && m.ctr && m.retention) {
    if (v.ctr > m.ctr * 1.15 && v.avgViewPct < m.retention * 0.85) {
      bad.push("제목·썸네일은 클릭을 끌었지만 본편에서 이탈 — 초반 30초 도입부와 약속한 내용의 일치 여부 점검");
    }
    if (v.ctr < m.ctr * 0.85 && v.avgViewPct > m.retention * 1.15) {
      good.push("본편 만족도는 높으나 클릭률이 낮음 — 제목·썸네일만 개선하면 성장 여지 큼");
    }
  }
  return { good, bad };
}

// ---- Channel-level pattern insights ----

export type PatternRow = { feature: string; bucket: string; n: number; medianScore: number; lift: number };

const titleLenBucket = (t: string) => (t.length <= 15 ? "제목 15자 이하" : t.length <= 30 ? "제목 16–30자" : "제목 31자 이상");
const durBucket = (v: VideoStat) => {
  const s = v.durationSec;
  if (v.format === "short") return s < 30 ? "쇼츠 30초 미만" : s < 60 ? "쇼츠 30–59초" : "쇼츠 60초 이상";
  const m = s / 60;
  return m < 5 ? "롱폼 5분 미만" : m < 10 ? "롱폼 5–10분" : m < 20 ? "롱폼 10–20분" : "롱폼 20분 이상";
};
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
// Day of week in KST, regardless of the server's timezone.
const weekday = (iso: string) => WEEKDAYS[new Date(Date.parse(iso) + 9 * 3600_000).getUTCDay()] + "요일 업로드";

export function patternInsights(scored: Scored[]): PatternRow[] {
  const rated = scored.filter((v) => v.score !== null);
  if (rated.length < 8) return [];
  const overall = median(rated.map((v) => v.score!));
  const features: [string, (v: Scored) => string][] = [
    ["제목 길이", (v) => titleLenBucket(v.title)],
    ["제목 숫자", (v) => (/\d/.test(v.title) ? "제목에 숫자 포함" : "제목에 숫자 없음")],
    ["제목 질문형", (v) => (/[?？]/.test(v.title) ? "질문형 제목" : "서술형 제목")],
    ["제목 괄호", (v) => (/[\[(【「]/.test(v.title) ? "괄호/태그 사용" : "괄호/태그 없음")],
    ["영상 길이", durBucket],
    ["업로드 요일", (v) => weekday(v.publishedAt)],
  ];
  const rows: PatternRow[] = [];
  for (const [feature, f] of features) {
    const groups = new Map<string, number[]>();
    for (const v of rated) {
      const k = f(v);
      groups.set(k, [...(groups.get(k) ?? []), v.score!]);
    }
    for (const [bucket, xs] of groups) {
      if (xs.length < 3) continue;
      const ms = median(xs);
      rows.push({ feature, bucket, n: xs.length, medianScore: Math.round(ms), lift: Math.round(ms - overall) });
    }
  }
  return rows.sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift));
}

export type ChannelSummary = {
  rated: number;
  byFormat: Record<"short" | "long", { n: number; medianViewsPerDay: number; medianRetention?: number; medianCvr?: number }>;
};

export function summarize(scored: Scored[]): ChannelSummary {
  const out = {} as ChannelSummary["byFormat"];
  for (const f of ["short", "long"] as const) {
    const xs = scored.filter((v) => v.format === f && v.score !== null);
    const ret = xs.map((v) => v.avgViewPct).filter((x): x is number => x !== undefined);
    const cvr = xs.map((v) => v.cvrPer1k).filter((x): x is number => x !== undefined);
    out[f] = {
      n: xs.length,
      medianViewsPerDay: Math.round(median(xs.map((v) => v.viewsPerDay))),
      medianRetention: ret.length ? Math.round(median(ret) * 10) / 10 : undefined,
      medianCvr: cvr.length ? Math.round(median(cvr) * 100) / 100 : undefined,
    };
  }
  return { rated: scored.filter((v) => v.score !== null).length, byFormat: out };
}
