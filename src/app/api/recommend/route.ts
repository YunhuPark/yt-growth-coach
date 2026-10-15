import { getAnalysis, getTrends } from "@/lib/analysis";
import { errorResponse } from "@/lib/http";
import { recommend } from "@/lib/recommend";
import { loadBaseline, loadRecommendation, loadTracking, saveRecommendation } from "@/lib/store";
import { trackedForAI } from "@/lib/tracking";

export const maxDuration = 300;

/** Last generated recommendation, so a page reload doesn't cost another LLM call. */
export async function GET() {
  return Response.json((await loadRecommendation()) ?? null);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { goal?: string; useTrends?: boolean };
    const a = await getAnalysis();
    const trends = body.useTrends === false ? null : await getTrends().catch(() => null);
    const goal = body.goal?.slice(0, 200) ?? "";
    const entries = await loadTracking();
    const tracked = entries.length ? await trackedForAI(entries, await loadBaseline()) : undefined;
    const result = await recommend({
      channel: { title: a.channel.title, subscribers: a.channel.subscribers, videoCount: a.channel.videoCount },
      scored: a.videos,
      patterns: a.patterns,
      trends,
      goal,
      tracked,
    });
    const saved = { at: new Date().toISOString(), goal, result };
    await saveRecommendation(saved);
    return Response.json(saved);
  } catch (e) {
    return errorResponse(e);
  }
}
