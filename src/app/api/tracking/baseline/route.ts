import { getAnalysis } from "@/lib/channel/analysis";
import { errorResponse } from "@/lib/shared/http";
import { getBaseline, summarizeBaseline } from "@/lib/channel/tracking";

export const maxDuration = 300;

/** Builds (or refreshes) the first-N-days baseline from my existing videos. One Analytics call per video. */
export async function POST(req: Request) {
  try {
    const { refresh } = (await req.json().catch(() => ({}))) as { refresh?: boolean };
    const a = await getAnalysis();
    return Response.json(summarizeBaseline(await getBaseline(a.videos, !!refresh)));
  } catch (e) {
    return errorResponse(e);
  }
}
