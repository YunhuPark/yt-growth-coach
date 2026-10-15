import { gget, GoogleApiError } from "./google";

const DATA = "https://www.googleapis.com/youtube/v3";
const ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";

export type VideoStat = {
  id: string;
  title: string;
  publishedAt: string;
  durationSec: number;
  format: "short" | "long";
  views: number;
  likes: number;
  comments: number;
  thumbnail?: string;
  tags?: string[]; // creator-set tags (hidden metadata)
  hashtags?: string[]; // #hashtags found in the title/description, lowercased, without '#'
  // From the Analytics API (owner-only metrics). Undefined when unavailable.
  avgViewPct?: number; // 0-100
  avgViewSec?: number;
  minutesWatched?: number;
  shares?: number;
  subsGained?: number;
  impressions?: number;
  ctr?: number; // 0-100 (%)
};

export type ChannelInfo = {
  id: string;
  title: string;
  handle?: string;
  subscribers: number;
  totalViews: number;
  videoCount: number;
  uploadsPlaylistId: string;
};

export function parseDuration(iso: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  const [, d, h, mi, s] = m.map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

// YouTube Shorts can be up to 3 minutes since Oct 2024.
export const SHORT_MAX_SEC = 180;

type ChannelsResp = {
  items?: {
    id: string;
    snippet: { title: string; customUrl?: string };
    statistics: { subscriberCount?: string; viewCount: string; videoCount: string };
    contentDetails: { relatedPlaylists: { uploads: string } };
  }[];
};

function toChannel(c: NonNullable<ChannelsResp["items"]>[number]): ChannelInfo {
  return {
    id: c.id,
    title: c.snippet.title,
    handle: c.snippet.customUrl,
    subscribers: Number(c.statistics.subscriberCount ?? 0),
    totalViews: Number(c.statistics.viewCount),
    videoCount: Number(c.statistics.videoCount),
    uploadsPlaylistId: c.contentDetails.relatedPlaylists.uploads,
  };
}

export async function getMyChannel(): Promise<ChannelInfo> {
  const r = await gget<ChannelsResp>(`${DATA}/channels`, {
    part: "snippet,statistics,contentDetails",
    mine: "true",
  });
  if (!r.items?.[0]) throw new Error("연결된 계정에서 YouTube 채널을 찾지 못했습니다.");
  return toChannel(r.items[0]);
}

/** Resolve "@handle" or a channel id (UC...) to a channel. Costs 1 quota unit. */
export async function resolveChannel(ref: string): Promise<ChannelInfo | null> {
  const isId = /^UC[\w-]{20,}$/.test(ref);
  const r = await gget<ChannelsResp>(
    `${DATA}/channels`,
    {
      part: "snippet,statistics,contentDetails",
      ...(isId ? { id: ref } : { forHandle: ref.startsWith("@") ? ref : `@${ref}` }),
    },
    { allowApiKey: true },
  );
  return r.items?.[0] ? toChannel(r.items[0]) : null;
}

type PlaylistResp = {
  nextPageToken?: string;
  items: { contentDetails: { videoId: string } }[];
};

type VideosResp = {
  items: {
    id: string;
    snippet: {
      title: string;
      publishedAt: string;
      channelId: string;
      channelTitle: string;
      categoryId?: string;
      description?: string;
      tags?: string[];
      thumbnails?: { medium?: { url: string } };
    };
    contentDetails: { duration: string };
    statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
  }[];
};

export async function recentVideoIds(playlistId: string, max: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < max) {
    const r = await gget<PlaylistResp>(
      `${DATA}/playlistItems`,
      { part: "contentDetails", playlistId, maxResults: 50, pageToken },
      { allowApiKey: true },
    );
    ids.push(...r.items.map((i) => i.contentDetails.videoId));
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  return ids.slice(0, max);
}

export function extractHashtags(...texts: (string | undefined)[]): string[] {
  const found = new Set<string>();
  for (const t of texts) {
    for (const m of t?.matchAll(/#([\p{L}\p{N}_]+)/gu) ?? []) found.add(m[1].toLowerCase());
  }
  return [...found];
}

export type RawVideo = VideoStat & { channelId: string; channelTitle: string; categoryId?: string };

export async function videoDetails(ids: string[]): Promise<RawVideo[]> {
  const out: RawVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await gget<VideosResp>(
      `${DATA}/videos`,
      { part: "snippet,contentDetails,statistics", id: ids.slice(i, i + 50).join(",") },
      { allowApiKey: true },
    );
    for (const v of r.items) {
      const durationSec = parseDuration(v.contentDetails.duration);
      out.push({
        id: v.id,
        title: v.snippet.title,
        publishedAt: v.snippet.publishedAt,
        durationSec,
        format: durationSec <= SHORT_MAX_SEC ? "short" : "long",
        views: Number(v.statistics.viewCount ?? 0),
        likes: Number(v.statistics.likeCount ?? 0),
        comments: Number(v.statistics.commentCount ?? 0),
        thumbnail: v.snippet.thumbnails?.medium?.url,
        tags: v.snippet.tags?.map((t) => t.toLowerCase()),
        hashtags: extractHashtags(v.snippet.title, v.snippet.description),
        channelId: v.snippet.channelId,
        channelTitle: v.snippet.channelTitle,
        categoryId: v.snippet.categoryId,
      });
    }
  }
  return out;
}

type AnalyticsResp = { columnHeaders: { name: string }[]; rows?: (string | number)[][] };

async function analyticsByVideo(
  metrics: string[],
  startDate: string,
  endDate: string,
): Promise<Map<string, Record<string, number>>> {
  const r = await gget<AnalyticsResp>(ANALYTICS, {
    ids: "channel==MINE",
    startDate,
    endDate,
    dimensions: "video",
    metrics: metrics.join(","),
    sort: "-views",
    maxResults: 200,
  });
  const names = r.columnHeaders.map((h) => h.name);
  const map = new Map<string, Record<string, number>>();
  for (const row of r.rows ?? []) {
    const rec: Record<string, number> = {};
    names.forEach((n, i) => {
      if (n !== "video") rec[n] = Number(row[i]);
    });
    map.set(String(row[0]), rec);
  }
  return map;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export type MyChannelData = {
  channel: ChannelInfo;
  videos: VideoStat[];
  notes: string[]; // data-availability caveats shown in the UI
};

/** Public stats for the latest `max` uploads, enriched with owner-only Analytics metrics. */
export async function loadMyChannel(max = 200): Promise<MyChannelData> {
  const notes: string[] = [];
  const channel = await getMyChannel();
  const ids = await recentVideoIds(channel.uploadsPlaylistId, max);
  const videos: VideoStat[] = await videoDetails(ids);
  if (videos.length === 0) return { channel, videos, notes: ["업로드된 영상이 없습니다."] };

  const start = videos.map((v) => v.publishedAt).sort()[0].slice(0, 10);
  const end = ymd(new Date());

  let core: Map<string, Record<string, number>> | null = null;
  try {
    core = await analyticsByVideo(
      [
        "views",
        "estimatedMinutesWatched",
        "averageViewDuration",
        "averageViewPercentage",
        "likes",
        "comments",
        "shares",
        "subscribersGained",
      ],
      start,
      end,
    );
  } catch (e) {
    notes.push(
      `Analytics API 지표(유지율·구독 전환 등)를 가져오지 못해 공개 지표만 사용합니다. (${
        e instanceof GoogleApiError ? e.status : "error"
      })`,
    );
  }

  // Thumbnail impressions / CTR are rejected by the Analytics API for per-video reports
  // ("query is not supported"), so they stay undefined and the UI says to check Studio.
  if (core) {
    notes.push("썸네일 노출·CTR은 YouTube Analytics API가 영상별 조회를 지원하지 않아 제외했습니다. (Studio에서 직접 확인) 쇼츠는 썸네일 클릭 없이 피드로 노출되어 CTR이 큰 의미가 없습니다.");
  }

  for (const v of videos) {
    const a = core?.get(v.id);
    if (a) {
      v.avgViewPct = a.averageViewPercentage;
      v.avgViewSec = a.averageViewDuration;
      v.minutesWatched = a.estimatedMinutesWatched;
      v.shares = a.shares;
      v.subsGained = a.subscribersGained;
    }
  }
  if (core && videos.length > 200) {
    notes.push("Analytics는 조회수 상위 200개 영상까지만 조회됩니다.");
  }
  return { channel, videos, notes };
}

// ---- Trend data (public, API key or OAuth) ----

export async function mostPopular(regionCode: string, categoryId: string, max = 30) {
  const r = await gget<VideosResp>(
    `${DATA}/videos`,
    {
      part: "snippet,contentDetails,statistics",
      chart: "mostPopular",
      regionCode,
      videoCategoryId: categoryId || undefined,
      maxResults: Math.min(max, 50),
    },
    { allowApiKey: true },
  );
  const rows: RawVideo[] = r.items.map((v) => {
    const durationSec = parseDuration(v.contentDetails.duration);
    return {
      id: v.id,
      title: v.snippet.title,
      publishedAt: v.snippet.publishedAt,
      durationSec,
      format: durationSec <= SHORT_MAX_SEC ? "short" : "long",
      views: Number(v.statistics.viewCount ?? 0),
      likes: Number(v.statistics.likeCount ?? 0),
      comments: Number(v.statistics.commentCount ?? 0),
      thumbnail: v.snippet.thumbnails?.medium?.url,
      channelId: v.snippet.channelId,
      channelTitle: v.snippet.channelTitle,
      categoryId: v.snippet.categoryId,
    };
  });
  return rows;
}

type SearchResp = { items: { id: { videoId: string } }[] };

/** Top videos for a keyword over the last 30 days. search.list costs 100 quota units. */
export async function searchRecent(keyword: string, regionCode: string, max = 15) {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const r = await gget<SearchResp>(
    `${DATA}/search`,
    {
      part: "snippet",
      q: keyword,
      type: "video",
      order: "viewCount",
      publishedAfter: since,
      regionCode,
      maxResults: max,
    },
    { allowApiKey: true },
  );
  return videoDetails(r.items.map((i) => i.id.videoId));
}

// ---- Channel discovery ----

type SearchHit = { id: { videoId: string }; snippet: { channelId: string; channelTitle: string; title: string } };

/** Recent short videos for a query, with their channel. search.list costs 100 quota units. */
export async function searchShorts(query: string, regionCode: string, max = 50) {
  const since = new Date(Date.now() - 180 * 86400_000).toISOString();
  const r = await gget<{ items: SearchHit[] }>(
    `${DATA}/search`,
    {
      part: "snippet",
      q: query,
      type: "video",
      videoDuration: "short", // < 4 min
      order: "viewCount",
      publishedAfter: since,
      regionCode,
      relevanceLanguage: "ko",
      maxResults: max,
    },
    { allowApiKey: true },
  );
  return r.items.map((i) => ({
    videoId: i.id.videoId,
    channelId: i.snippet.channelId,
    channelTitle: i.snippet.channelTitle,
    title: i.snippet.title,
  }));
}

export async function channelsByIds(ids: string[]): Promise<ChannelInfo[]> {
  const out: ChannelInfo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await gget<ChannelsResp>(
      `${DATA}/channels`,
      { part: "snippet,statistics,contentDetails", id: ids.slice(i, i + 50).join(","), maxResults: 50 },
      { allowApiKey: true },
    );
    out.push(...(r.items ?? []).map(toChannel));
  }
  return out;
}

// ---- Source-video lookup (links and viewer timestamps only; nothing is downloaded) ----

export type VideoInfo = {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  durationSec: number;
  views: number;
  description: string;
};

export async function videoInfo(ids: string[]): Promise<VideoInfo[]> {
  const out: VideoInfo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await gget<VideosResp>(
      `${DATA}/videos`,
      { part: "snippet,contentDetails,statistics", id: ids.slice(i, i + 50).join(",") },
      { allowApiKey: true },
    );
    for (const v of r.items) {
      out.push({
        id: v.id,
        title: v.snippet.title,
        channelId: v.snippet.channelId,
        channelTitle: v.snippet.channelTitle,
        publishedAt: v.snippet.publishedAt,
        durationSec: parseDuration(v.contentDetails.duration),
        views: Number(v.statistics.viewCount ?? 0),
        description: v.snippet.description ?? "",
      });
    }
  }
  return out;
}

/** Longer (>4 min) videos for a query, best match first. search.list costs 100 quota units. */
export async function searchLong(query: string, regionCode: string, duration: "medium" | "long", max = 10) {
  const r = await gget<{ items: SearchHit[] }>(
    `${DATA}/search`,
    {
      part: "snippet",
      q: query,
      type: "video",
      videoDuration: duration,
      order: "relevance",
      regionCode,
      relevanceLanguage: "ko",
      maxResults: max,
    },
    { allowApiKey: true },
  );
  return r.items.map((i) => i.id.videoId);
}

/** "1:02:03", "12:34", "0:45" -> seconds. Returns every timestamp found in the text. */
export function findTimestamps(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?<![\d:])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?![\d:])/g)) {
    const sec = (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]);
    if (Number(m[3]) < 60) out.push(sec);
  }
  return out;
}

/** Most-liked comments that point at a moment ("12:34 ㅋㅋㅋ"). Comments may be disabled, then []. */
export async function timestampComments(videoId: string) {
  try {
    const r = await gget<{
      items: { snippet: { topLevelComment: { snippet: { textDisplay: string; likeCount: number } } } }[];
    }>(
      `${DATA}/commentThreads`,
      { part: "snippet", videoId, order: "relevance", maxResults: 50, textFormat: "plainText" },
      { allowApiKey: true, preferApiKey: true },
    );
    const rows: { sec: number; text: string; likes: number }[] = [];
    for (const it of r.items) {
      const c = it.snippet.topLevelComment.snippet;
      const ts = findTimestamps(c.textDisplay);
      if (ts.length) rows.push({ sec: ts[0], text: c.textDisplay.replace(/\s+/g, " ").slice(0, 70), likes: c.likeCount });
    }
    return rows.sort((a, b) => b.likes - a.likes).slice(0, 5);
  } catch {
    return [];
  }
}
