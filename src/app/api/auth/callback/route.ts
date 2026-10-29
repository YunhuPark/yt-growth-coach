import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { clearCache } from "@/lib/channel/analysis";
import { exchangeCode } from "@/lib/shared/google";
import { errorResponse } from "@/lib/shared/http";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const jar = await cookies();
  const expected = jar.get("oauth_state")?.value;
  jar.delete("oauth_state");

  const err = searchParams.get("error");
  if (err) return Response.redirect(`${origin}/channel?authError=${encodeURIComponent(err)}`, 302);

  const code = searchParams.get("code");
  if (!code || !expected || searchParams.get("state") !== expected) {
    return Response.redirect(`${origin}/channel?authError=state_mismatch`, 302);
  }
  try {
    await exchangeCode(code);
    clearCache();
    return Response.redirect(`${origin}/channel`, 302);
  } catch (e) {
    return errorResponse(e);
  }
}
