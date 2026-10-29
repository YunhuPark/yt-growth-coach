// Does the AI's 1-10 score for a Shorts candidate predict how the uploaded Short actually did? Each clip made from a candidate
// is linked to the video it became; the video's quality score (percentile among my own Shorts) is the "actual" side.

export type ValidationPair = {
  clipId: string;
  title: string;
  videoId: string;
  videoTitle: string;
  aiScore: number;
  /** quality score 0-100 of the uploaded video within my channel */
  actual: number;
  viewsPerDay: number;
};

export type Verdict = "insufficient" | "good" | "weak" | "none" | "inverse";

export type Validation = {
  /** clips linked to an uploaded video */
  linked: number;
  /** of those, the ones whose video already has a quality score (7+ days old) */
  rated: number;
  pairs: ValidationPair[];
  /** Spearman rank correlation between AI score and actual score; null with fewer than 3 pairs or no spread on one side */
  rho: number | null;
  verdict: Verdict;
  /** average actual score of the higher- and lower-AI-scored half; null below 4 pairs */
  halves: { high: number; low: number } | null;
};

export const MIN_PAIRS = 5;

/** Ranks from 1, ties share their average rank. */
export function ranks(xs: number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = rank;
    i = j + 1;
  }
  return out;
}

/** Spearman's rho (Pearson correlation of the ranks); null when either side has no variation or fewer than 3 points. */
export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const a = ranks(xs);
  const b = ranks(ys);
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  if (da === 0 || db === 0) return null;
  return Math.round((num / Math.sqrt(da * db)) * 100) / 100;
}

export type ClipLink = { id: string; title: string; aiScore: number; videoId?: string };
export type VideoPerf = { id: string; title: string; score: number | null; viewsPerDay: number };

export function validateClips(clips: ClipLink[], videos: VideoPerf[]): Validation {
  const byId = new Map(videos.map((v) => [v.id, v]));
  const linkedClips = clips.filter((c) => c.videoId);
  const pairs: ValidationPair[] = [];
  for (const c of linkedClips) {
    const v = byId.get(c.videoId!);
    if (!v || v.score === null) continue;
    pairs.push({
      clipId: c.id,
      title: c.title,
      videoId: v.id,
      videoTitle: v.title,
      aiScore: c.aiScore,
      actual: Math.round(v.score),
      viewsPerDay: Math.round(v.viewsPerDay),
    });
  }

  const rho = pairs.length >= 3 ? spearman(pairs.map((p) => p.aiScore), pairs.map((p) => p.actual)) : null;
  let verdict: Verdict = "insufficient";
  if (pairs.length >= MIN_PAIRS && rho !== null) verdict = rho >= 0.5 ? "good" : rho >= 0.2 ? "weak" : rho > -0.2 ? "none" : "inverse";

  let halves: Validation["halves"] = null;
  if (pairs.length >= 4) {
    const sorted = [...pairs].sort((a, b) => b.aiScore - a.aiScore);
    const h = Math.floor(sorted.length / 2);
    const avg = (xs: ValidationPair[]) => Math.round(xs.reduce((s, p) => s + p.actual, 0) / xs.length);
    halves = { high: avg(sorted.slice(0, h)), low: avg(sorted.slice(sorted.length - h)) };
  }
  return { linked: linkedClips.length, rated: pairs.length, pairs, rho, verdict, halves };
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  insufficient: `아직 비교할 영상이 부족합니다. 점수가 매겨진(업로드 7일 이상) 연결 영상이 ${MIN_PAIRS}개 이상 쌓이면 판단합니다.`,
  good: "AI 점수가 높았던 쇼츠가 실제로도 잘 나오는 편입니다. 후보를 고를 때 점수를 참고해도 좋습니다.",
  weak: "AI 점수와 실제 성과가 약하게 맞습니다. 점수는 참고만 하고 직접 판단을 더 믿으세요.",
  none: "AI 점수와 실제 성과 사이에 뚜렷한 관계가 없습니다. 점수에 의존하지 마세요.",
  inverse: "AI 점수가 높은 쇼츠가 오히려 성과가 낮았습니다. 점수를 믿지 말고, 표본이 쌓일 때까지 직접 판단하세요.",
};
