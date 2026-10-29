import { getAnalysis } from "@/lib/channel/analysis";
import { findSimilarChannels, profileChannel } from "@/lib/channel/discover";
import { errorResponse } from "@/lib/shared/http";
import { loadSettings } from "@/lib/shared/store";

export const maxDuration = 180;

// Cached: the search step costs ~500 YouTube quota units plus per-channel lookups and two LLM calls.
const g = globalThis as unknown as { __discover?: { at: number; value: unknown } };

export async function POST(req: Request) {
  try {
    const { refresh } = (await req.json().catch(() => ({}))) as { refresh?: boolean };
    if (!refresh && g.__discover && Date.now() - g.__discover.at < 60 * 60_000) {
      return Response.json(g.__discover.value);
    }
    const a = await getAnalysis();
    const { regionCode } = await loadSettings();
    const profile = await profileChannel(a.channel, a.videos);
    const myShortsPct = (a.videos.filter((v) => v.format === "short").length / Math.max(1, a.videos.length)) * 100;
    const found = await findSimilarChannels(profile, regionCode, a.channel, myShortsPct);
    const value = { profile, ...found };
    g.__discover = { at: Date.now(), value };
    return Response.json(value);
  } catch (e) {
    return errorResponse(e);
  }
}
