import { NextResponse, type NextRequest } from "next/server";
import { DEMO_REFUSAL } from "@/lib/shared/demo";

/**
 * In the public demo (NEXT_PUBLIC_DEMO=1) nothing that needs the server to work for a visitor is available: every API route answers
 * 403 and the channel dashboard goes back to the front page. Anywhere else this does nothing but block cross-site writes.
 */
export function proxy(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_DEMO === "1") {
    if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: DEMO_REFUSAL }, { status: 403 });
    return NextResponse.redirect(new URL("/", request.url));
  }
  // Local runs have no auth in front of the ~30 API routes. Binding the dev server to 127.0.0.1 keeps other
  // machines off it, but a page the user visits can still make a "simple" cross-site request (text/plain form
  // post, no preflight) to localhost:3000/api/collect and trigger the work even though it cannot read the reply.
  // So state-changing API calls must come from our own origin.
  if (isStateChangingApiRequest(request) && !isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.next();
}

function isStateChangingApiRequest(request: NextRequest): boolean {
  if (!request.nextUrl.pathname.startsWith("/api/")) return false;
  return request.method !== "GET" && request.method !== "HEAD";
}

/** Browsers set `Sec-Fetch-Site` for every request, and `Origin` for anything that is not a same-origin GET. */
function isSameOrigin(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true; // curl, server-to-server, same-origin GET: nothing to compare
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const ownHosts = [request.nextUrl.host, request.headers.get("host")].filter((h): h is string => Boolean(h));
  return ownHosts.some((host) => hostMatches(originHost, host));
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function splitHostPort(host: string): [string, string] {
  const lower = host.toLowerCase();
  if (lower.startsWith("[")) {
    const end = lower.indexOf("]");
    if (end === -1) return [lower, ""];
    const rest = lower.slice(end + 1);
    return [lower.slice(1, end), rest.startsWith(":") ? rest.slice(1) : ""];
  }
  const colon = lower.lastIndexOf(":");
  if (colon === -1) return [lower, ""];
  return [lower.slice(0, colon), lower.slice(colon + 1)];
}

/** Same host:port, or the same loopback address under different names (localhost / 127.0.0.1 / [::1]). */
function hostMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const [aName, aPort] = splitHostPort(a);
  const [bName, bPort] = splitHostPort(b);
  if (aPort !== bPort) return false;
  return aName === bName || (LOOPBACK_HOSTNAMES.has(aName) && LOOPBACK_HOSTNAMES.has(bName));
}

export const config = { matcher: ["/api/:path*", "/channel/:path*", "/channel"] };
