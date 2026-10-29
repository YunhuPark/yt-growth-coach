// Hermetic: a temp working directory (for the saved answers) and a stubbed fetch, so YouTube is never contacted.
// Modules are imported after chdir because the storage folder is resolved from process.cwd() when store.ts loads.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it, mock } from "node:test";

let shorts: typeof import("../src/lib/shared/shorts");
let tmp: string;
const originalCwd = process.cwd();
const requested: string[] = [];

/** What the stubbed YouTube answers for each id: a status, plus where it redirects to. */
let answers: Record<string, { status: number; location?: string } | "throw">;

const stub = () =>
  mock.method(globalThis, "fetch", async (input: unknown) => {
    const id = decodeURIComponent(String(input).split("/shorts/")[1]);
    requested.push(id);
    const a = answers[id] ?? { status: 303, location: `https://www.youtube.com/watch?v=${id}` };
    if (a === "throw") throw new Error("network down");
    return new Response(null, { status: a.status, headers: a.location ? { location: a.location } : {} });
  });

before(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), "ytgc-shorts-"));
  mkdirSync(path.join(tmp, ".data"));
  process.chdir(tmp);
  shorts = await import("../src/lib/shared/shorts");
});

after(() => {
  process.chdir(originalCwd);
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  mock.restoreAll();
  requested.length = 0;
  answers = {};
  rmSync(path.join(tmp, ".data", "shorts.json"), { force: true });
  stub();
});

const FAST = { gapMs: 0 }; // tests do not need the polite pause between requests

const vid = (id: string, durationSec: number, format: "short" | "long" = durationSec <= 180 ? "short" : "long") => ({ id, durationSec, format });

describe("checkShort", () => {
  it("says true when the Shorts page opens", async () => {
    answers.a = { status: 200 };
    assert.equal(await shorts.checkShort("a"), true);
  });

  it("says false when YouTube redirects to the normal watch page", async () => {
    assert.equal(await shorts.checkShort("b"), false);
  });

  it("does not guess when the answer is ambiguous", async () => {
    answers.c = { status: 303, location: "https://consent.youtube.com/m?continue=..." }; // consent / bot-check page
    answers.d = { status: 429 };
    answers.e = { status: 500 };
    answers.f = "throw";
    for (const id of ["c", "d", "e", "f"]) assert.equal(await shorts.checkShort(id), null, id);
  });
});

describe("refineFormats", () => {
  it("never asks about videos longer than 3 minutes, which cannot be Shorts", async () => {
    const list = [vid("long1", 181), vid("long2", 600, "short")]; // a wrongly-labelled long video is corrected without a request
    const r = await shorts.refineFormats(list, FAST);
    assert.deepEqual(requested, []);
    assert.deepEqual(list.map((v) => v.format), ["long", "long"]);
    assert.equal(r.reclassified, 0);
  });

  it("moves a 3-minutes-or-less video to long-form when YouTube says it is not a Short", async () => {
    answers.real = { status: 200 };
    const list = [vid("real", 20), vid("stage", 150)]; // "stage" is horizontal: the duration rule says short, YouTube disagrees
    const r = await shorts.refineFormats(list, FAST);
    assert.deepEqual(list.map((v) => v.format), ["short", "long"]);
    assert.deepEqual(r, { confirmed: 1, reclassified: 1, unknown: 0 });
  });

  it("keeps the duration rule for videos it could not check", async () => {
    answers.x = "throw";
    const list = [vid("x", 30)];
    const r = await shorts.refineFormats(list, FAST);
    assert.equal(list[0].format, "short");
    assert.deepEqual(r, { confirmed: 0, reclassified: 0, unknown: 1 });
    assert.equal(existsSync(path.join(tmp, ".data", "shorts.json")) && "x" in JSON.parse(readFileSync(path.join(tmp, ".data", "shorts.json"), "utf8")), false, "an unanswered check is not saved");
  });

  it("saves answers and does not ask again", async () => {
    answers.s = { status: 200 };
    await shorts.refineFormats([vid("s", 20), vid("n", 90)], FAST);
    assert.deepEqual(JSON.parse(readFileSync(path.join(tmp, ".data", "shorts.json"), "utf8")), { s: true, n: false });
    requested.length = 0;
    const list = [vid("s", 20), vid("n", 90)];
    await shorts.refineFormats(list, FAST);
    assert.deepEqual(requested, [], "a second pass is served from the saved answers");
    assert.deepEqual(list.map((v) => v.format), ["short", "long"]);
  });

  it("stops asking after repeated failures instead of hammering YouTube", async () => {
    for (let i = 0; i < 30; i++) answers[`v${i}`] = { status: 429 };
    const list = Array.from({ length: 30 }, (_, i) => vid(`v${i}`, 20));
    const r = await shorts.refineFormats(list, FAST);
    assert.equal(requested.length, 5, "requests go one at a time, so it stops exactly at the failure limit");
    assert.equal(r.unknown, 30);
    assert.ok(list.every((v) => v.format === "short"));
  });

  it("recovers: a success resets the failure count", async () => {
    // fail, fail, ok, fail, fail, ok ... never 5 in a row, so everything gets checked
    const list = Array.from({ length: 12 }, (_, i) => vid(`r${i}`, 20));
    list.forEach((v, i) => (answers[v.id] = i % 3 === 2 ? { status: 200 } : { status: 429 }));
    await shorts.refineFormats(list, FAST);
    assert.equal(requested.length, 12);
  });
});

describe("per-call limit", () => {
  it("checks at most maxChecks videos per call and finishes the rest on the next call", async () => {
    const make = () => Array.from({ length: 10 }, (_, i) => vid(`c${i}`, 20));
    const first = make();
    const r1 = await shorts.refineFormats(first, { gapMs: 0, maxChecks: 4 });
    assert.equal(requested.length, 4);
    assert.equal(r1.unknown, 6);

    requested.length = 0;
    const r2 = await shorts.refineFormats(make(), { gapMs: 0, maxChecks: 4 });
    assert.equal(requested.length, 4, "only the six unanswered videos are candidates, four of them this time");
    assert.equal(r2.unknown, 2);
    assert.ok(!requested.some((id) => ["c0", "c1", "c2", "c3"].includes(id)), "answered videos are not asked again");
  });
});

describe("formatCheckNotes", () => {
  it("explains what changed and what could not be checked, and stays quiet otherwise", () => {
    assert.deepEqual(shorts.formatCheckNotes({ confirmed: 5, reclassified: 0, unknown: 0 }), []);
    const notes = shorts.formatCheckNotes({ confirmed: 5, reclassified: 2, unknown: 3 });
    assert.equal(notes.length, 2);
    assert.match(notes[0], /2개 영상은 3분 이하지만 .*롱폼으로 분류/);
    assert.match(notes[1], /3개 영상은 쇼츠 여부를 아직 확인하지 못해 길이/);
  });
});
