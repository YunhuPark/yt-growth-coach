import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";

const original = process.env.NEXT_PUBLIC_DEMO;
afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_DEMO;
  else process.env.NEXT_PUBLIC_DEMO = original;
});

const call = (method: string, path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://127.0.0.1:3000${path}`, { method, headers, ...(method === "GET" ? {} : { body: "{}" }) });

describe("cross-site write protection outside the demo", () => {
  it("refuses a state-changing API call from another origin", () => {
    delete process.env.NEXT_PUBLIC_DEMO;
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = proxy(call(method, "/api/collect", { origin: "http://evil.example" }));
      assert.equal(res.status, 403, method);
    }
  });

  it("refuses a cross-site request even without an Origin header", () => {
    delete process.env.NEXT_PUBLIC_DEMO;
    const res = proxy(call("POST", "/api/collect", { "sec-fetch-site": "cross-site" }));
    assert.equal(res.status, 403);
    const sameSite = proxy(call("POST", "/api/collect", { "sec-fetch-site": "same-origin" }));
    assert.equal(sameSite.headers.get("x-middleware-next"), "1");
  });

  it("allows a write from our own origin, curl and the same-site devtools flows", () => {
    delete process.env.NEXT_PUBLIC_DEMO;
    const ownOriginHeaders: Record<string, string>[] = [
      { origin: "http://127.0.0.1:3000" },
      { origin: "http://localhost:3000", host: "localhost:3000" },
      {},
    ];
    for (const headers of ownOriginHeaders) {
      const res = proxy(call("POST", "/api/collect", headers));
      assert.equal(res.headers.get("x-middleware-next"), "1", JSON.stringify(headers));
    }
  });

  it("leaves reads alone", () => {
    delete process.env.NEXT_PUBLIC_DEMO;
    const res = proxy(call("GET", "/api/health", { origin: "http://evil.example" }));
    assert.equal(res.headers.get("x-middleware-next"), "1");
  });

  it("keeps the demo refusal first", async () => {
    process.env.NEXT_PUBLIC_DEMO = "1";
    const res = proxy(call("POST", "/api/collect", { origin: "http://evil.example" }));
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /공개 데모/);
  });
});
