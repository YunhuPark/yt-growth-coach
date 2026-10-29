import { loadTokens, saveTokens, type Tokens } from "./store";

export const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

function cfg() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/api/auth/callback";
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET이 .env.local에 설정되지 않았습니다.");
  }
  return { clientId, clientSecret, redirectUri };
}

export function authUrl(state: string) {
  const { clientId, redirectUri } = cfg();
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`Google 토큰 요청 실패 (${res.status}): ${await res.text()}`);
  return res.json();
}

export async function exchangeCode(code: string) {
  const { clientId, clientSecret, redirectUri } = cfg();
  const r = await tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const tokens: Tokens = {
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    expires_at: Date.now() + r.expires_in * 1000,
  };
  await saveTokens(tokens);
}

export async function getAccessToken(): Promise<string | null> {
  const t = await loadTokens();
  if (!t) return null;
  if (t.expires_at - 60_000 > Date.now()) return t.access_token;
  if (!t.refresh_token) return null;
  const { clientId, clientSecret } = cfg();
  const r = await tokenRequest({
    refresh_token: t.refresh_token,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  const next: Tokens = {
    access_token: r.access_token,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + r.expires_in * 1000,
  };
  await saveTokens(next);
  return next.access_token;
}

export class GoogleApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** GET a Google API URL using the OAuth token (or an API key when allowed). */
export async function gget<T>(
  url: string,
  params: Record<string, string | number | undefined>,
  opts: { allowApiKey?: boolean; preferApiKey?: boolean } = {},
): Promise<T> {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = {};
  // Some endpoints (comments) reject the read-only OAuth scope; a plain API key works and avoids asking for broader access.
  const useKey = opts.preferApiKey && !!process.env.YOUTUBE_API_KEY;
  const token = useKey ? null : await getAccessToken();
  if (useKey) u.searchParams.set("key", process.env.YOUTUBE_API_KEY!);
  else if (token) headers.Authorization = `Bearer ${token}`;
  else if (opts.allowApiKey && process.env.YOUTUBE_API_KEY) {
    u.searchParams.set("key", process.env.YOUTUBE_API_KEY);
  } else {
    throw new GoogleApiError(401, "YouTube 계정이 연결되지 않았습니다.");
  }
  const res = await fetch(u, { headers, cache: "no-store" });
  if (!res.ok) {
    throw new GoogleApiError(res.status, `${u.pathname} 실패 (${res.status}): ${await res.text()}`);
  }
  return res.json();
}
