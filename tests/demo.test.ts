import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";

const original = process.env.NEXT_PUBLIC_DEMO;
afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_DEMO;
  else process.env.NEXT_PUBLIC_DEMO = original;
});

const req = (path: string) => new NextRequest(`http://localhost:3000${path}`);

describe("the public demo proxy", () => {
  it("does nothing outside the demo", () => {
    delete process.env.NEXT_PUBLIC_DEMO;
    for (const p of ["/api/render", "/channel", "/api/health"]) {
      const res = proxy(req(p));
      assert.equal(res.status, 200, p);
      assert.equal(res.headers.get("x-middleware-next"), "1", p);
    }
  });

  it("refuses every API route in the demo, with a reason", async () => {
    process.env.NEXT_PUBLIC_DEMO = "1";
    for (const p of ["/api/render", "/api/autoedit", "/api/auth/login", "/api/health", "/api/usage"]) {
      const res = proxy(req(p));
      assert.equal(res.status, 403, p);
      const body = (await res.json()) as { error: string };
      assert.match(body.error, /공개 데모/);
    }
  });

  it("sends the channel dashboard back to the front page in the demo", () => {
    process.env.NEXT_PUBLIC_DEMO = "1";
    const res = proxy(req("/channel"));
    assert.equal(res.status, 307);
    assert.equal(new URL(res.headers.get("location") ?? "").pathname, "/");
  });

  it("only watches the API and the channel page", async () => {
    const { config } = await import("../src/proxy");
    assert.deepEqual(config.matcher, ["/api/:path*", "/channel/:path*", "/channel"]);
  });
});
