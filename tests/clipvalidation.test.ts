// The clips.ts tests are hermetic: they run in a temp working directory so the real .data/ is never touched.
// Modules are imported only after chdir because the storage folder is resolved from process.cwd() when store.ts loads.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { ranks, spearman, validateClips, type ClipLink, type VideoPerf } from "../src/lib/channel/clipValidation";

describe("ranks and spearman", () => {
  it("gives tied values their average rank", () => {
    assert.deepEqual(ranks([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
    assert.deepEqual(ranks([5]), [1]);
  });

  it("is 1 for the same order, -1 for the opposite, and ignores the scale", () => {
    assert.equal(spearman([1, 2, 3, 4, 5], [10, 20, 35, 80, 100]), 1);
    assert.equal(spearman([1, 2, 3, 4, 5], [9, 7, 5, 3, 1]), -1);
  });

  it("is null with fewer than 3 points or when one side never varies", () => {
    assert.equal(spearman([1, 2], [1, 2]), null);
    assert.equal(spearman([5, 5, 5, 5], [1, 2, 3, 4]), null);
    assert.equal(spearman([1, 2, 3], [1, 2]), null);
  });

  it("gives a value in between for a partly matching order", () => {
    const r = spearman([1, 2, 3, 4, 5, 6], [2, 1, 4, 3, 6, 5])!;
    assert.ok(r > 0.7 && r < 1, `got ${r}`);
  });
});

describe("validateClips", () => {
  const clip = (i: number, aiScore: number, videoId?: string): ClipLink => ({ id: `c${i}`, title: `클립 ${i}`, aiScore, videoId });
  const perf = (i: number, score: number | null): VideoPerf => ({ id: `v${i}`, title: `영상 ${i}`, score, viewsPerDay: 100 + i });

  it("only counts clips linked to a video that already has a quality score", () => {
    const v = validateClips(
      [clip(1, 8, "v1"), clip(2, 5, "v2"), clip(3, 6), clip(4, 7, "gone")],
      [perf(1, 70), perf(2, null)],
    );
    assert.equal(v.linked, 3);
    assert.equal(v.rated, 1);
    assert.equal(v.pairs[0].actual, 70);
    assert.equal(v.verdict, "insufficient");
    assert.equal(v.rho, null);
  });

  it("says the AI score works when ranks agree, with enough clips", () => {
    const clips = [1, 2, 3, 4, 5, 6].map((i) => clip(i, i + 2, `v${i}`));
    const videos = [1, 2, 3, 4, 5, 6].map((i) => perf(i, i * 10));
    const v = validateClips(clips, videos);
    assert.equal(v.rho, 1);
    assert.equal(v.verdict, "good");
    assert.deepEqual(v.halves, { high: 50, low: 20 });
  });

  it("flags a score that points the wrong way, and one with no relation", () => {
    const clips = [1, 2, 3, 4, 5, 6].map((i) => clip(i, i, `v${i}`));
    assert.equal(validateClips(clips, [1, 2, 3, 4, 5, 6].map((i) => perf(i, 100 - i * 10))).verdict, "inverse");
    const noisy = [50, 20, 60, 30, 55, 25];
    assert.equal(validateClips(clips, noisy.map((s, i) => perf(i + 1, s))).verdict, "none");
  });

  it("does not judge below five scored clips even when they line up", () => {
    const clips = [1, 2, 3, 4].map((i) => clip(i, i, `v${i}`));
    const v = validateClips(clips, [1, 2, 3, 4].map((i) => perf(i, i * 10)));
    assert.equal(v.rho, 1);
    assert.equal(v.verdict, "insufficient");
    assert.ok(v.halves, "the halves comparison is already shown at four");
  });
});

describe("clip records", () => {
  let clips: typeof import("../src/lib/channel/clips");
  let store: typeof import("../src/lib/shared/store");
  let tmp: string;
  const originalCwd = process.cwd();

  before(async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "ytgc-clips-"));
    process.chdir(tmp);
    store = await import("../src/lib/shared/store");
    clips = await import("../src/lib/channel/clips");
  });
  after(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });
  beforeEach(() => store.saveClips([]));

  const input = (id: string, over = {}) => ({
    id, sourceName: "긴영상.mp4", aiScore: 7, reason: "이유", title: "제목", hook: "훅", start: 10, end: 40, lengthFit: "within" as const, ...over,
  });
  const A = "a".repeat(16);
  const B = "b".repeat(16);

  it("records a clip newest first and keeps an existing link when registered again", async () => {
    await clips.registerClip(input(A));
    await clips.registerClip(input(B));
    await clips.linkClip(A, "https://youtu.be/dQw4w9WgXcQ");
    await clips.registerClip(input(A, { aiScore: 9 }));
    const all = await store.loadClips();
    assert.deepEqual(all.map((c) => c.id), [A, B]);
    assert.equal(all[0].aiScore, 9);
    assert.equal(all[0].videoId, "dQw4w9WgXcQ");
  });

  it("clamps the score and strips control characters from text", async () => {
    const r = await clips.registerClip(input(A, { aiScore: 99, title: "제목\u0007\n끝" }));
    assert.equal(r.aiScore, 10);
    assert.equal(r.title, "제목  끝");
  });

  it("links by id or URL, refuses a video that already belongs to another clip, and unlinks", async () => {
    await clips.registerClip(input(A));
    await clips.registerClip(input(B));
    await clips.linkClip(A, "dQw4w9WgXcQ");
    await assert.rejects(clips.linkClip(B, "https://www.youtube.com/shorts/dQw4w9WgXcQ"), /이미 다른 쇼츠/);
    await assert.rejects(clips.linkClip(B, "not a video"), /알아볼 수 없습니다/);
    await assert.rejects(clips.linkClip("c".repeat(16), "dQw4w9WgXcQ"), /찾지 못했습니다/);
    const un = await clips.linkClip(A, null);
    assert.equal(un.videoId, undefined);
    await clips.linkClip(B, "dQw4w9WgXcQ"); // free again
  });

  it("deletes a clip", async () => {
    await clips.registerClip(input(A));
    await clips.deleteClip(A);
    assert.deepEqual(await store.loadClips(), []);
  });
});
