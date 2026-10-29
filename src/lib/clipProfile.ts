// What has worked on this channel, boiled down for the clip finder: the Shorts that scored best and worst, and the length
// range the best ones share. It only describes the creator's own past results; it says nothing about the video being cut.
// This file is the shape the editor asks for; where the numbers come from (the channel analysis) is not its business.

export type ClipProfile = {
  /** Shorts with a quality score (7+ days old, enough data) */
  rated: number;
  best: ClipRef[];
  worst: ClipRef[];
  /** length range (seconds) shared by the top third of rated Shorts; null until there are enough of them */
  lengthRange: { min: number; max: number } | null;
  /** short pattern findings, e.g. "쇼츠 30–59초: 중앙 점수 +12 (n=6)" */
  notes: string[];
};

export type ClipRef = {
  title: string;
  durationSec: number;
  score: number;
  viewsPerDay: number;
  retentionPct?: number;
  cvrPer1k?: number;
};

export const MIN_SHORTS_FOR_RANGE = 6;

export type LengthFit = "within" | "shorter" | "longer";

/** How a clip's length compares with the range the channel's best Shorts share. */
export function lengthFit(seconds: number, profile: ClipProfile | null | undefined): LengthFit | null {
  const r = profile?.lengthRange;
  if (!r) return null;
  return seconds < r.min ? "shorter" : seconds > r.max ? "longer" : "within";
}

export function describeProfile(p: ClipProfile): string {
  const line = (c: ClipRef) =>
    `- "${c.title}" ${Math.round(c.durationSec)}초 · 점수 ${c.score} · 하루 조회 ${c.viewsPerDay}` +
    (c.retentionPct !== undefined ? ` · 지속률 ${c.retentionPct}%` : "") +
    (c.cvrPer1k !== undefined ? ` · 구독전환 ${c.cvrPer1k}/천회` : "");
  return [
    `이 채널의 쇼츠 성과(참고 자료, 점수 ${p.rated}개 기준):`,
    p.lengthRange ? `잘된 쇼츠의 길이 범위: ${p.lengthRange.min}~${p.lengthRange.max}초` : "",
    "잘된 쇼츠:",
    ...p.best.map(line),
    "부진한 쇼츠:",
    ...p.worst.map(line),
    p.notes.length ? `패턴: ${p.notes.join(" / ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
