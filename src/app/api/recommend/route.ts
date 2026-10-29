import { errorResponse } from "@/lib/shared/http";
import { generateRecommendation } from "@/lib/channel/flows";
import { loadRecommendation } from "@/lib/shared/store";

export const maxDuration = 300;

/** Last generated recommendation, so a page reload doesn't cost another LLM call. */
export async function GET() {
  return Response.json((await loadRecommendation()) ?? null);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { goal?: string; useTrends?: boolean };
    return Response.json(await generateRecommendation(body));
  } catch (e) {
    return errorResponse(e);
  }
}
