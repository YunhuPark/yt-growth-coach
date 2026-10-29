import { NextResponse, type NextRequest } from "next/server";
import { DEMO_REFUSAL } from "@/lib/demo";

/**
 * In the public demo (NEXT_PUBLIC_DEMO=1) nothing that needs the server to work for a visitor is available: every API route answers
 * 403 and the channel dashboard goes back to the front page. Anywhere else this does nothing.
 */
export function proxy(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_DEMO !== "1") return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: DEMO_REFUSAL }, { status: 403 });
  return NextResponse.redirect(new URL("/", request.url));
}

export const config = { matcher: ["/api/:path*", "/channel/:path*", "/channel"] };
