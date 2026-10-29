import { median } from "./metrics";
import type { Settings } from "../shared/store";
import {
  mostPopular,
  recentVideoIds,
  resolveChannel,
  searchRecent,
  videoDetails,
  type RawVideo,
} from "../shared/youtube";

export type TrendVideo = {
  id: string;
  title: string;
  channelTitle: string;
  format: "short" | "long";
  durationSec: number;
  views: number;
  viewsPerDay: number;
  ageDays: number;
  /** views/day relative to the median of the same channel's recent uploads (competitors only) */
  outlier?: number;
  thumbnail?: string;
};

export type TrendData = {
  popular: TrendVideo[];
  competitors: { channel: string; subscribers: number; medianViewsPerDay: number; hits: TrendVideo[] }[];
  keywords: { keyword: string; videos: TrendVideo[] }[];
  notes: string[];
};

function toTrend(v: RawVideo, now: number): TrendVideo {
  const ageDays = Math.max(1, (now - Date.parse(v.publishedAt)) / 86400_000);
  return {
    id: v.id,
    title: v.title,
    channelTitle: v.channelTitle,
    format: v.format,
    durationSec: v.durationSec,
    views: v.views,
    viewsPerDay: Math.round(v.views / ageDays),
    ageDays: Math.round(ageDays),
    thumbnail: v.thumbnail,
  };
}

export async function loadTrends(s: Settings): Promise<TrendData> {
  const now = Date.now();
  const notes: string[] = [];

  const popular = await mostPopular(s.regionCode, s.categoryId, 30)
    .then((rows) => rows.map((v) => toTrend(v, now)))
    .catch((e: Error) => {
      notes.push(`인기 급상승 영상을 가져오지 못했습니다: ${e.message.slice(0, 120)}`);
      return [] as TrendVideo[];
    });

  const competitors: TrendData["competitors"] = [];
  for (const ref of s.competitors) {
    try {
      const ch = await resolveChannel(ref);
      if (!ch) {
        notes.push(`경쟁 채널을 찾지 못했습니다: ${ref}`);
        continue;
      }
      const ids = await recentVideoIds(ch.uploadsPlaylistId, 30);
      const vids = (await videoDetails(ids)).map((v) => toTrend(v, now));
      const settled = vids.filter((v) => v.ageDays >= 3);
      const med = median(settled.map((v) => v.viewsPerDay));
      const hits = settled
        .map((v) => ({ ...v, outlier: med ? Math.round((v.viewsPerDay / med) * 10) / 10 : undefined }))
        .filter((v) => (v.outlier ?? 0) >= 1.5)
        .sort((a, b) => (b.outlier ?? 0) - (a.outlier ?? 0))
        .slice(0, 5);
      competitors.push({
        channel: ch.title,
        subscribers: ch.subscribers,
        medianViewsPerDay: Math.round(med),
        hits,
      });
    } catch (e) {
      notes.push(`경쟁 채널 ${ref} 조회 실패: ${(e as Error).message.slice(0, 100)}`);
    }
  }

  const keywords: TrendData["keywords"] = [];
  for (const keyword of s.keywords) {
    try {
      const vids = await searchRecent(keyword, s.regionCode, 12);
      keywords.push({ keyword, videos: vids.map((v) => toTrend(v, now)) });
    } catch (e) {
      notes.push(`키워드 "${keyword}" 검색 실패: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  return { popular, competitors, keywords, notes };
}
