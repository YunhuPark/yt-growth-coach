import Anthropic from "@anthropic-ai/sdk";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { loadUsage, saveUsage, type Pricing, type UsageCall, type UsageRecord } from "./store";

// Measures what each piece of work costs: AI tokens per call and time per stage. Work is wrapped in `tracked()`; every AI
// call made inside it (through `trackedClient`) and every `timed()` stage is added to that piece of work's record, which is
// saved when it finishes. The numbers are what a price has to be built on, so nothing here is estimated or assumed.

type Ledger = { calls: UsageCall[]; stages: Record<string, number>; meta: UsageRecord["meta"] };
const als = new AsyncLocalStorage<Ledger>();

// Saves run one after another: each is a read-modify-write of the same file.
let queue: Promise<unknown> = Promise.resolve();
function persist(record: UsageRecord) {
  if (process.env.USAGE_LOG === "off") return queue; // USAGE_LOG=off: measure nothing (used by tests)
  queue = queue
    .then(async () => saveUsage([...(await loadUsage()), record]))
    .catch(() => {
      /* measuring must never break the work being measured */
    });
  return queue;
}

/** Waits for pending saves to finish (tests and shutdown). */
export const flushUsage = () => queue;

const newRecord = (kind: string, ledger: Ledger, ok: boolean, wallMs: number): UsageRecord => ({
  id: randomBytes(6).toString("hex"),
  at: new Date().toISOString(),
  kind,
  ok,
  wallMs: Math.round(wallMs),
  calls: ledger.calls,
  stages: ledger.stages,
  meta: ledger.meta,
});

/**
 * Runs `fn` as one measured piece of work. Inside another tracked piece (a render started from a flow, say) it just runs, so
 * its calls and stages count toward the outer one.
 */
export async function tracked<T>(kind: string, fn: () => Promise<T>, meta: UsageRecord["meta"] = {}): Promise<T> {
  if (als.getStore()) return fn();
  const ledger: Ledger = { calls: [], stages: {}, meta: { ...meta } };
  const t0 = Date.now();
  let ok = false;
  try {
    const out = await als.run(ledger, fn);
    ok = true;
    return out;
  } finally {
    await persist(newRecord(kind, ledger, ok, Date.now() - t0));
  }
}

/** Adds the time `fn` takes to a named stage of the current piece of work (summed if the stage repeats). */
export async function timed<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  const ledger = als.getStore();
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    if (ledger) ledger.stages[stage] = (ledger.stages[stage] ?? 0) + (Date.now() - t0);
  }
}

/** Notes a size that drives cost (video length, picture count...) on the current piece of work. */
export function addMeta(meta: UsageRecord["meta"]) {
  const ledger = als.getStore();
  if (ledger) Object.assign(ledger.meta, meta);
}

/** Records one AI call: on the current piece of work, or as a piece of work of its own when none is active. */
export function recordCall(call: UsageCall) {
  const ledger = als.getStore();
  if (ledger) {
    ledger.calls.push(call);
    return;
  }
  void persist(newRecord(call.label, { calls: [call], stages: {}, meta: {} }, true, call.ms));
}

/**
 * An Anthropic client whose structured-output calls are measured. Everything else about it is the normal client, so call
 * sites only change where the client is created.
 */
export function trackedClient(label: string): Anthropic {
  const client = new Anthropic();
  const original = client.messages.parse.bind(client.messages);
  client.messages.parse = (async (...args: Parameters<typeof original>) => {
    const t0 = Date.now();
    const res = await original(...args);
    recordCall({
      label,
      model: String((args[0] as { model?: string }).model ?? "unknown"),
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
      ms: Date.now() - t0,
    });
    return res;
  }) as typeof original;
  return client;
}

// ---------------------------------------------------------------- numbers

/** Cost in USD of one call at the entered prices, or null while a price is missing. */
export function callCostUsd(c: UsageCall, p: Pricing): number | null {
  if (p.inputPerMTok === undefined || p.outputPerMTok === undefined) return null;
  return (c.inputTokens * p.inputPerMTok + c.outputTokens * p.outputPerMTok) / 1_000_000;
}

export const recordCostUsd = (r: UsageRecord, p: Pricing): number | null => {
  if (!r.calls.length) return 0;
  const parts = r.calls.map((c) => callCostUsd(c, p));
  return parts.some((x) => x === null) ? null : (parts as number[]).reduce((a, b) => a + b, 0);
};

export type KindSummary = {
  kind: string;
  runs: number;
  failed: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  /** average AI cost per run in USD; null until prices are entered (or when no run made an AI call) */
  avgCostUsd: number | null;
  avgWallSec: number;
  /** average seconds per stage across the runs that had it */
  stageAvgSec: Record<string, number>;
  /** average of each size that was noted, such as input video seconds */
  metaAvg: Record<string, number>;
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Per kind of work: how many runs and what a typical one costs in tokens, money and time. Failed runs count in `failed` only. */
export function summarizeUsage(records: UsageRecord[], pricing: Pricing): KindSummary[] {
  const kinds = [...new Set(records.map((r) => r.kind))];
  return kinds
    .map((kind): KindSummary => {
      const all = records.filter((r) => r.kind === kind);
      const ok = all.filter((r) => r.ok);
      const costs = ok.map((r) => recordCostUsd(r, pricing));
      const known = costs.every((c) => c !== null) && ok.some((r) => r.calls.length > 0);
      const stageNames = [...new Set(ok.flatMap((r) => Object.keys(r.stages)))];
      const metaNames = [...new Set(ok.flatMap((r) => Object.keys(r.meta).filter((k) => typeof r.meta[k] === "number")))];
      return {
        kind,
        runs: ok.length,
        failed: all.length - ok.length,
        avgInputTokens: Math.round(avg(ok.map((r) => r.calls.reduce((n, c) => n + c.inputTokens, 0)))),
        avgOutputTokens: Math.round(avg(ok.map((r) => r.calls.reduce((n, c) => n + c.outputTokens, 0)))),
        avgCostUsd: known ? avg(costs as number[]) : null,
        avgWallSec: r1(avg(ok.map((r) => r.wallMs / 1000))),
        stageAvgSec: Object.fromEntries(
          stageNames.map((s) => [s, r1(avg(ok.filter((r) => s in r.stages).map((r) => r.stages[s] / 1000)))]),
        ),
        metaAvg: Object.fromEntries(
          metaNames.map((m) => [m, r1(avg(ok.filter((r) => typeof r.meta[m] === "number").map((r) => r.meta[m] as number)))]),
        ),
      };
    })
    .sort((a, b) => b.runs + b.failed - (a.runs + a.failed));
}

export { marginKrw } from "./margin";
