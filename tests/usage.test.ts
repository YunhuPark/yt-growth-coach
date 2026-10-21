// Hermetic: runs in a temp working directory (usage.json is written under .data/ of the cwd) and stubs fetch for the AI call,
// so it never touches the real data or the network. Modules are imported only after chdir.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { z } from "zod";
import type { UsageRecord } from "../src/lib/store";

const originalCwd = process.cwd();
let tmp: string;
let usage: typeof import("../src/lib/usage");
let store: typeof import("../src/lib/store");

before(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), "ytgc-usage-"));
  process.chdir(tmp);
  store = await import("../src/lib/store");
  usage = await import("../src/lib/usage");
});
after(() => {
  process.chdir(originalCwd);
  rmSync(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  await usage.flushUsage();
  await store.saveUsage([]);
});

const call = (over = {}) => ({ label: "x", model: "m", inputTokens: 1000, outputTokens: 500, ms: 100, ...over });

describe("tracked work", () => {
  it("records the calls, stage times and sizes of one piece of work", async () => {
    const out = await usage.tracked(
      "highlights",
      async () => {
        await usage.timed("ffmpeg 분석", async () => new Promise((r) => setTimeout(r, 30)));
        usage.addMeta({ inputSec: 600 });
        usage.recordCall(call());
        usage.recordCall(call({ inputTokens: 200, outputTokens: 100 }));
        return "result";
      },
      { speech: true },
    );
    assert.equal(out, "result");
    await usage.flushUsage();
    const [r] = await store.loadUsage();
    assert.equal(r.kind, "highlights");
    assert.equal(r.ok, true);
    assert.equal(r.calls.length, 2);
    assert.ok(r.stages["ffmpeg 분석"] >= 25);
    assert.deepEqual(r.meta, { speech: true, inputSec: 600 });
    assert.ok(r.wallMs >= 25);
  });

  it("records a failed run as failed and still throws the error", async () => {
    await assert.rejects(
      usage.tracked("render", async () => {
        usage.recordCall(call());
        throw new Error("boom");
      }),
      /boom/,
    );
    await usage.flushUsage();
    const [r] = await store.loadUsage();
    assert.equal(r.ok, false);
    assert.equal(r.calls.length, 1, "what was spent before the failure still counts");
  });

  it("counts work started inside another piece of work toward the outer one", async () => {
    await usage.tracked("prepare", async () => {
      await usage.tracked("inner", async () => usage.recordCall(call()));
      usage.recordCall(call());
    });
    await usage.flushUsage();
    const all = await store.loadUsage();
    assert.equal(all.length, 1);
    assert.equal(all[0].kind, "prepare");
    assert.equal(all[0].calls.length, 2);
  });

  it("keeps separate pieces of work apart even when they overlap in time", async () => {
    await Promise.all([
      usage.tracked("a", async () => {
        await new Promise((r) => setTimeout(r, 20));
        usage.recordCall(call({ label: "from-a" }));
      }),
      usage.tracked("b", async () => {
        usage.recordCall(call({ label: "from-b" }));
        await new Promise((r) => setTimeout(r, 40));
      }),
    ]);
    await usage.flushUsage();
    const byKind = Object.fromEntries((await store.loadUsage()).map((r) => [r.kind, r.calls.map((c) => c.label)]));
    assert.deepEqual(byKind, { a: ["from-a"], b: ["from-b"] });
  });

  it("records a call made outside any tracked work as its own record, and lets timed run without one", async () => {
    assert.equal(await usage.timed("nobody is listening", async () => 5), 5);
    usage.recordCall(call({ label: "lone" }));
    await usage.flushUsage();
    const [r] = await store.loadUsage();
    assert.equal(r.kind, "lone");
    assert.equal(r.calls.length, 1);
  });

  it("saves every record when many finish at the same moment", async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => usage.tracked(`k${i}`, async () => usage.recordCall(call()))));
    await usage.flushUsage();
    assert.equal((await store.loadUsage()).length, 12);
  });
});

describe("the AI client", () => {
  it("records the token counts and time of a structured-output call made through it", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const fake = mock.method(globalThis, "fetch", async () =>
      new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "test-model",
          content: [{ type: "text", text: '{"answer": 42}' }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1234, output_tokens: 567 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    try {
      const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
      const Out = z.object({ answer: z.number() });
      const out = await usage.tracked("probe", async () => {
        const client = usage.trackedClient("probe-call");
        return client.messages.parse({
          model: "test-model",
          max_tokens: 100,
          output_config: { format: zodOutputFormat(Out) },
          messages: [{ role: "user", content: "hi" }],
        });
      });
      assert.equal(out.parsed_output?.answer, 42, "the answer still comes back unchanged");
      await usage.flushUsage();
      const [r] = await store.loadUsage();
      assert.equal(r.kind, "probe");
      assert.deepEqual(
        r.calls.map((c) => [c.label, c.model, c.inputTokens, c.outputTokens]),
        [["probe-call", "test-model", 1234, 567]],
      );
      assert.ok(r.calls[0].ms >= 0);
    } finally {
      fake.mock.restore();
    }
  });
});

const rec = (over: Partial<UsageRecord> = {}): UsageRecord => ({
  id: "r", at: "2026-10-20T00:00:00Z", kind: "highlights", ok: true, wallMs: 60_000,
  calls: [call({ inputTokens: 100_000, outputTokens: 10_000 })], stages: { "ffmpeg 분석": 20_000 }, meta: { inputSec: 600 }, ...over,
});

describe("cost numbers", () => {
  const prices = { inputPerMTok: 3, outputPerMTok: 15, usdToKrw: 1400 };

  it("is unknown until both prices are entered, then tokens times price", () => {
    assert.equal(usage.callCostUsd(call(), {}), null);
    assert.equal(usage.callCostUsd(call(), { inputPerMTok: 3 }), null);
    assert.equal(usage.callCostUsd(call({ inputTokens: 1_000_000, outputTokens: 2_000_000 }), { inputPerMTok: 3, outputPerMTok: 15 }), 33);
    assert.equal(usage.recordCostUsd(rec({ calls: [] }), {}), 0, "work with no AI call costs nothing in tokens");
  });

  it("averages per kind, counts failures separately and leaves failed runs out of the averages", () => {
    const records = [
      rec(),
      rec({ calls: [call({ inputTokens: 300_000, outputTokens: 30_000 })], wallMs: 120_000, stages: { "ffmpeg 분석": 40_000, "음성 인식": 8_000 }, meta: { inputSec: 1200 } }),
      rec({ ok: false, calls: [call({ inputTokens: 9_000_000 })] }),
      rec({ kind: "render", calls: [], wallMs: 5_000, stages: {}, meta: { outputSec: 30 } }),
    ];
    const [h, r] = usage.summarizeUsage(records, prices);
    assert.equal(h.kind, "highlights");
    assert.equal(h.runs, 2);
    assert.equal(h.failed, 1);
    assert.equal(h.avgInputTokens, 200_000);
    assert.equal(h.avgOutputTokens, 20_000);
    assert.ok(Math.abs(h.avgCostUsd! - (0.45 + 1.35) / 2) < 1e-9, `got ${h.avgCostUsd}`); // 100k in + 10k out, and 300k in + 30k out
    assert.equal(h.avgWallSec, 90);
    assert.deepEqual(h.stageAvgSec, { "ffmpeg 분석": 30, "음성 인식": 8 }, "a stage is averaged over the runs that had it");
    assert.deepEqual(h.metaAvg, { inputSec: 900 });
    assert.equal(r.kind, "render");
    assert.equal(r.avgCostUsd, null, "no AI call, so there is no AI cost to average");
  });

  it("keeps the cost unknown when prices are missing", () => {
    assert.equal(usage.summarizeUsage([rec()], {})[0].avgCostUsd, null);
  });

  it("works out the margin on a price per run in won", () => {
    assert.deepEqual(usage.marginKrw(1000, 0.3, 1400), { costKrw: 420, marginKrw: 580, marginPct: 58 });
    assert.equal(usage.marginKrw(1000, null, 1400), null);
    assert.equal(usage.marginKrw(1000, 0.3, undefined), null);
    assert.equal(usage.marginKrw(0, 0.3, 1400)!.marginPct, 0);
  });
});
