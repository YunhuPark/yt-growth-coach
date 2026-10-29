import type { NextRequest } from "next/server";
import { getTrends } from "@/lib/channel/analysis";
import { errorResponse } from "@/lib/shared/http";

export async function GET(req: NextRequest) {
  try {
    return Response.json(await getTrends(req.nextUrl.searchParams.has("refresh")));
  } catch (e) {
    return errorResponse(e);
  }
}
