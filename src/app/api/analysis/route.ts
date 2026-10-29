import type { NextRequest } from "next/server";
import { getAnalysis } from "@/lib/channel/analysis";
import { errorResponse } from "@/lib/shared/http";
import { loadTokens } from "@/lib/shared/store";

export async function GET(req: NextRequest) {
  try {
    if (!(await loadTokens())) {
      return Response.json({ connected: false, configured: !!process.env.GOOGLE_CLIENT_ID });
    }
    const data = await getAnalysis(req.nextUrl.searchParams.has("refresh"));
    return Response.json({ connected: true, ...data });
  } catch (e) {
    return errorResponse(e);
  }
}
