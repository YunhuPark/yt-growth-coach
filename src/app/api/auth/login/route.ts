import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { authUrl } from "@/lib/google";
import { errorResponse } from "@/lib/http";

export async function GET() {
  try {
    const state = randomBytes(16).toString("hex");
    (await cookies()).set("oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    return Response.redirect(authUrl(state), 302);
  } catch (e) {
    return errorResponse(e);
  }
}
