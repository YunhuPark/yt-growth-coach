// Runs in a temp working directory (the previews folder is under .data/ of the cwd) with a real ffmpeg.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const originalCwd = process.cwd();
const FFMPEG = path.join(originalCwd, "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const hasFfmpeg = existsSync(FFMPEG);

describe("previewId", () => {
  it("is stable for the same file and range and changes with the file, the time stamp or the range", async () => {
    const { previewId } = await import("../src/lib/editor/preview");
    const a = previewId("/x/a.mp4", 100, 5, 20);
    assert.match(a, /^[a-f0-9]{16}$/);
    assert.equal(a, previewId("/x/a.mp4", 100, 5, 20));
    assert.notEqual(a, previewId("/x/b.mp4", 100, 5, 20));
    assert.notEqual(a, previewId("/x/a.mp4", 101, 5, 20), "a changed file gets a new preview");
    assert.notEqual(a, previewId("/x/a.mp4", 100, 5, 21));
  });
});

describe("makePreview", { skip: !hasFfmpeg ? "needs the bundled ffmpeg" : false, timeout: 120_000 }, () => {
  let tmp: string;
  let src: string;
  let mod: typeof import("../src/lib/editor/preview");
  let render: typeof import("../src/lib/editor/render");

  before(async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "ytgc-preview-"));
    src = path.join(tmp, "src.mp4");
    const r = spawnSync(FFMPEG, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc2=s=640x360:r=15:d=12", "-f", "lavfi", "-i", "sine=frequency=300:duration=12",
      "-shortest", "-pix_fmt", "yuv420p", src,
    ]);
    assert.equal(r.status, 0, String(r.stderr));
    process.chdir(tmp);
    mod = await import("../src/lib/editor/preview");
    render = await import("../src/lib/editor/render");
  });
  after(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("makes a small copy of just the requested stretch, 360 pixels tall, with sound", async () => {
    const { id, durationSec } = await mod.makePreview(src, 3, 8);
    assert.equal(durationSec, 5);
    const info = await render.probe(mod.previewFile(id), tmp);
    assert.ok(Math.abs(info.duration - 5) < 0.4, `got ${info.duration}`);
    assert.equal(info.height, 360);
    assert.equal(info.hasAudio, true);
  });

  it("answers the same request again from the existing file without re-encoding", async () => {
    const first = await mod.makePreview(src, 1, 4);
    const before = (await import("node:fs")).statSync(mod.previewFile(first.id)).mtimeMs;
    const second = await mod.makePreview(src, 1, 4);
    assert.equal(second.id, first.id);
    assert.equal((await import("node:fs")).statSync(mod.previewFile(second.id)).mtimeMs, before);
  });

  it("stops at the end of the file when the range runs past it, and refuses a start beyond it", async () => {
    const { id, durationSec } = await mod.makePreview(src, 10, 40);
    assert.equal(durationSec, 2);
    assert.ok(Math.abs((await render.probe(mod.previewFile(id), tmp)).duration - 2) < 0.4);
    await assert.rejects(mod.makePreview(src, 50, 60), /영상 길이를 넘었습니다/);
  });

  it("rejects bad ranges and ranges that are too long", async () => {
    await assert.rejects(mod.makePreview(src, 5, 5), /시작과 끝/);
    await assert.rejects(mod.makePreview(src, -1, 5), /시작과 끝/);
    await assert.rejects(mod.makePreview(src, 0, Number.NaN), /시작과 끝/);
    await assert.rejects(mod.makePreview(src, 0, mod.MAX_PREVIEW_SEC + 1), /초까지만/);
  });

  it("leaves no half-written file behind after a failure", async () => {
    await assert.rejects(mod.makePreview(src, 50, 60));
    const { readdirSync } = await import("node:fs");
    assert.ok(!readdirSync(mod.previewsDir()).some((f) => f.endsWith(".part.mp4")));
  });

  it("deletes previews older than a day and keeps recent ones", async () => {
    const old = await mod.makePreview(src, 2, 6);
    const fresh = await mod.makePreview(src, 6, 9);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600_000);
    utimesSync(mod.previewFile(old.id), twoDaysAgo, twoDaysAgo);
    await mod.pruneOldPreviews();
    assert.equal(existsSync(mod.previewFile(old.id)), false);
    assert.equal(existsSync(mod.previewFile(fresh.id)), true);
  });
});
