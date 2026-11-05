import type { NextRequest } from "next/server";
import { getAnalysis } from "@/lib/channel/analysis";
import { GoogleApiError } from "@/lib/shared/google";
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
    // A saved sign-in that Google no longer accepts is not a failure of the page: the person only has to sign in again.
    if (e instanceof GoogleApiError && e.status === 401) return Response.json({ connected: false, configured: !!process.env.GOOGLE_CLIENT_ID, expired: true });
    return errorResponse(e);
  }
}
