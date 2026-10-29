// Hermetic: runs in a temp working directory with fake environment values, so it never reads the real login file or keys.
// Modules are imported only after chdir because the storage folder and ffmpeg path are resolved from process.cwd().
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { EMPTY_SOURCE, hasSource, sourceName, sourceReady } from "../src/components/editor/source";

const originalCwd = process.cwd();
const SECRET = "sk-test-SECRET-VALUE-12345";
let tmp: string;
let health: typeof import("../src/lib/editor/health");
const saved = { a: process.env.ANTHROPIC_API_KEY, y: process.env.YOUTUBE_API_KEY };

before(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), "ytgc-health-"));
  process.chdir(tmp);
  process.env.ANTHROPIC_API_KEY = SECRET;
  delete process.env.YOUTUBE_API_KEY;
  health = await import("../src/lib/editor/health");
});
after(() => {
  process.chdir(originalCwd);
  if (saved.a === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = saved.a;
  if (saved.y !== undefined) process.env.YOUTUBE_API_KEY = saved.y;
  rmSync(tmp, { recursive: true, force: true });
});

describe("checkHealth", () => {
  it("reports each item with whether it is required, and says what to do when one is missing", async () => {
    const items = await health.checkHealth();
    assert.deepEqual(items.map((i) => i.id), ["ffmpeg", "font", "anthropic", "youtubeKey", "speechModel", "personModel", "google"]);
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    assert.equal(by.anthropic.required, true);
    assert.equal(by.google.required, false, "the editing tools do not need a Google sign-in");
    assert.equal(by.youtubeKey.required, false);
    assert.equal(by.speechModel.required, false);
    assert.equal(by.personModel.required, false);
    for (const i of items) assert.ok(i.fix.length > 10, `${i.id} has guidance`);
  });

  it("sees which keys are set without ever returning their values", async () => {
    const items = await health.checkHealth();
    const by = Object.fromEntries(items.map((i) => [i.id, i.ok]));
    assert.equal(by.anthropic, true);
    assert.equal(by.youtubeKey, false);
    assert.ok(!JSON.stringify(items).includes(SECRET));
  });

  it("knows whether a Google login exists", async () => {
    assert.equal((await health.checkHealth()).find((i) => i.id === "google")!.ok, false);
    mkdirSync(path.join(tmp, ".data"), { recursive: true });
    writeFileSync(path.join(tmp, ".data", "tokens.json"), JSON.stringify({ access_token: "x", expires_at: 1 }));
    assert.equal((await health.checkHealth()).find((i) => i.id === "google")!.ok, true);
  });

  it("knows whether the speech model has been downloaded", async () => {
    assert.equal((await health.checkHealth()).find((i) => i.id === "speechModel")!.ok, false);
    const f = health.speechModelFile();
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, "x");
    assert.equal((await health.checkHealth()).find((i) => i.id === "speechModel")!.ok, true);
  });
});

describe("the shared source", () => {
  const file = (name: string) => ({ name }) as unknown as File;

  it("is ready only with a video and the rights confirmation", () => {
    assert.equal(hasSource(EMPTY_SOURCE), false);
    assert.equal(sourceReady(EMPTY_SOURCE), false);
    assert.equal(sourceReady({ ...EMPTY_SOURCE, sourcePath: "D:\\a.mp4" }), false, "a path alone is not enough");
    assert.equal(sourceReady({ ...EMPTY_SOURCE, sourcePath: "D:\\a.mp4", confirmed: true }), false, "nor is a checkbox without the basis");
    assert.equal(sourceReady({ ...EMPTY_SOURCE, sourcePath: "D:\\a.mp4", confirmed: true, basis: "own_footage" }), true);
    assert.equal(sourceReady({ ...EMPTY_SOURCE, file: file("a.mp4"), confirmed: true, basis: "licensed" }), true);
  });

  it("does not count a blank path as a video", () => {
    assert.equal(hasSource({ ...EMPTY_SOURCE, sourcePath: "   " }), false);
  });

  it("shows the file name, from an upload or from a path of either slash style", () => {
    assert.equal(sourceName({ ...EMPTY_SOURCE, file: file("내영상.mp4") }), "내영상.mp4");
    assert.equal(sourceName({ ...EMPTY_SOURCE, sourcePath: "D:\\영상\\긴영상.mp4" }), "긴영상.mp4");
    assert.equal(sourceName({ ...EMPTY_SOURCE, sourcePath: "/home/me/clip.mov" }), "clip.mov");
    assert.equal(sourceName(EMPTY_SOURCE), "");
  });
});
