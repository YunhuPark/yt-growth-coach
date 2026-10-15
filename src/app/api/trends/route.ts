import type { NextRequest } from "next/server";
import { getTrends } from "@/lib/analysis";
import { errorResponse } from "@/lib/http";

export async function GET(req: NextRequest) {
  try {
    return Response.json(await getTrends(req.nextUrl.searchParams.has("refresh")));
  } catch (e) {
    return errorResponse(e);
  }
}
