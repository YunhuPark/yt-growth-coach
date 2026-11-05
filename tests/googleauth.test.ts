// A stored Google sign-in that Google refuses (expired or revoked) must not break reads that an API key can do.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it, mock } from "node:test";

process.env.USAGE_LOG = "off";

const originalCwd = process.cwd();
let tmp: string;
let google: typeof import("../src/lib/shared/google");
let calls: string[] = [];

before(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), "ytgc-google-"));
  mkdirSync(path.join(tmp, ".data"));
  // an access token that has run out and a refresh token Google will refuse
  writeFileSync(path.join(tmp, ".data", "tokens.json"), JSON.stringify({ access_token: "old", refresh_token: "revoked", expires_at: 1 }));
  process.chdir(tmp);
  process.env.GOOGLE_CLIENT_ID = "id";
  process.env.GOOGLE_CLIENT_SECRET = "secret";
  google = await import("../src/lib/shared/google");
});

after(() => {
  process.chdir(originalCwd);
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.YOUTUBE_API_KEY;
});

beforeEach(() => {
  calls = [];
  delete process.env.YOUTUBE_API_KEY;
  mock.method(globalThis, "fetch", async (input: unknown) => {
    const url = new URL(String(input));
    calls.push(url.hostname + url.pathname);
    if (url.hostname === "oauth2.googleapis.com") {
      return new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }), { status: 400 });
    }
    return new Response(JSON.stringify({ ok: true, key: url.searchParams.get("key") }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});

describe("gget with a sign-in Google refuses", () => {
  it("falls back to the API key when one is allowed, instead of failing the read", async () => {
    process.env.YOUTUBE_API_KEY = "api-key";
    const r = await google.gget<{ ok: boolean; key: string }>("https://www.googleapis.com/youtube/v3/videos", { id: "x" }, { allowApiKey: true });
    assert.equal(r.ok, true);
    assert.equal(r.key, "api-key");
    assert.deepEqual(calls, ["oauth2.googleapis.com/token", "www.googleapis.com/youtube/v3/videos"], "tried the refresh, then read with the key");
  });

  it("does not even try the sign-in when the key is preferred", async () => {
    process.env.YOUTUBE_API_KEY = "api-key";
    await google.gget("https://www.googleapis.com/youtube/v3/commentThreads", {}, { allowApiKey: true, preferApiKey: true });
    assert.deepEqual(calls, ["www.googleapis.com/youtube/v3/commentThreads"]);
  });

  it("says plainly that the sign-in has expired when nothing else can do the read", async () => {
    await assert.rejects(
      google.gget("https://www.googleapis.com/youtube/analytics", {}, {}),
      (e: unknown) => e instanceof google.GoogleApiError && e.status === 401 && /다시 로그인/.test(e.message) && /invalid_grant/.test(e.message),
    );
    await assert.rejects(google.gget("https://www.googleapis.com/youtube/v3/videos", {}, { allowApiKey: true }), /다시 로그인/, "an allowed key does not exist here");
  });
});

describe("the channel page with a sign-in Google refuses", () => {
  it("is told the sign-in expired, so it can offer to sign in again (not a setup guide, not an error)", async () => {
    const { GET } = await import("../src/app/api/analysis/route");
    const { NextRequest } = await import("next/server");
    const res = await GET(new NextRequest("http://localhost:3000/api/analysis"));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { connected: false, configured: true, expired: true });
  });
});

describe("disconnecting the channel", () => {
  it("removes the saved sign-in, after which the channel page asks to connect from scratch", async () => {
    const { existsSync } = await import("node:fs");
    const { POST } = await import("../src/app/api/auth/logout/route");
    const { GET } = await import("../src/app/api/analysis/route");
    const { NextRequest } = await import("next/server");
    assert.ok(existsSync(path.join(tmp, ".data", "tokens.json")), "there is a saved sign-in to remove");
    const res = await POST();
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(existsSync(path.join(tmp, ".data", "tokens.json")), false);
    const after = await (await GET(new NextRequest("http://localhost:3000/api/analysis"))).json();
    assert.deepEqual(after, { connected: false, configured: true }, "not connected, and not marked as expired");
  });
});
