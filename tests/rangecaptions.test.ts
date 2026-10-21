import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { lengthMismatch, MISMATCH_LIMIT, rangeCaptions } from "../src/lib/rangeCaptions";
import { extractAudio } from "../src/lib/transcribe";

const FFMPEG = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

describe("lengthMismatch", () => {
  it("is the difference as a share of the original video's length", () => {
    assert.equal(lengthMismatch(600, 600), 0);
    assert.ok(Math.abs(lengthMismatch(630, 600) - 0.05) < 1e-9);
    assert.ok(lengthMismatch(300, 600) > MISMATCH_LIMIT);
    assert.equal(lengthMismatch(10, 0), 10, "a zero-length original does not divide by zero");
  });
});

describe("rangeCaptions", { skip: !existsSync(FFMPEG) ? "needs the bundled ffmpeg" : false, timeout: 120_000 }, () => {
  let dir: string;
  let withAudio: string;
  let silent: string;

  const make = (name: string, args: string[]) => {
    const out = path.join(dir, name);
    const r = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...args, out]);
    assert.equal(r.status, 0, String(r.stderr));
    return out;
  };

  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ytgc-range-"));
    // 12 s: 440 Hz for the first 6 s, 880 Hz for the last 6 s
    withAudio = make("a.mp4", [
      "-f", "lavfi", "-i", "color=s=64x64:r=5:d=12",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
      "-f", "lavfi", "-i", "sine=frequency=880:duration=6",
      "-filter_complex", "[1:a][2:a]concat=n=2:v=0:a=1[a]",
      "-map", "0:v", "-map", "[a]", "-pix_fmt", "yuv420p", "-shortest",
    ]);
    silent = make("s.mp4", ["-f", "lavfi", "-i", "color=s=64x64:r=5:d=12", "-pix_fmt", "yuv420p"]);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("starts reading the sound at the requested point, not at the start of the file", async () => {
    const full = await extractAudio(withAudio, path.join(dir, "w0"), 100);
    const later = await extractAudio(withAudio, path.join(dir, "w1"), 4, 8);
    assert.ok(Math.abs(later.length - 4 * 16000) < 1600, `got ${later.length}`);
    // zero crossings per second tell the pitch: about 880 Hz after 6 s versus 440 Hz before
    const rate = (a: Float32Array) => {
      let n = 0;
      for (let i = 1; i < a.length; i++) if (a[i - 1] < 0 !== a[i] < 0) n++;
      return (n / 2) / (a.length / 16000);
    };
    assert.ok(Math.abs(rate(later) - 880) < 60, `later ${rate(later)}`);
    assert.ok(Math.abs(rate(full.slice(0, 3 * 16000)) - 440) < 60);
  });

  it("returns the file length and the dialogue of just that range, on the clip's own timeline", async () => {
    let seen = 0;
    const r = await rangeCaptions({
      input: withAudio, dir: path.join(dir, "w2"), start: 3, end: 9, speech: true,
      transcriber: async (samples) => {
        seen = samples.length;
        return [{ start: 0.5, end: 2.5, text: "첫 대사" }, { start: 3, end: 5.5, text: "둘째 대사" }];
      },
    });
    assert.ok(Math.abs(r.fileDurationSec - 12) < 0.4);
    assert.ok(Math.abs(seen / 16000 - 6) < 0.2, `the engine got ${seen / 16000} s`);
    assert.deepEqual(r.captions.map((c) => [c.start, c.end, c.text]), [[0.5, 2.5, "첫 대사"], [3, 5.5, "둘째 대사"]]);
    assert.equal(r.hasAudio, true);
  });

  it("does not run speech recognition when it is off or the file has no sound", async () => {
    const boom = async () => {
      throw new Error("must not be called");
    };
    const off = await rangeCaptions({ input: withAudio, dir: path.join(dir, "w3"), start: 0, end: 5, speech: false, transcriber: boom });
    assert.deepEqual(off.captions, []);
    const mute = await rangeCaptions({ input: silent, dir: path.join(dir, "w4"), start: 0, end: 5, speech: true, transcriber: boom });
    assert.deepEqual(mute.captions, []);
    assert.equal(mute.hasAudio, false);
  });

  it("clamps the end to the file and refuses a start beyond it, a bad range, or a range that is too long", async () => {
    const r = await rangeCaptions({ input: withAudio, dir: path.join(dir, "w5"), start: 8, end: 40, speech: false });
    assert.ok(r.end <= 12.4 && r.end > 11.5);
    await assert.rejects(rangeCaptions({ input: withAudio, dir: path.join(dir, "w6"), start: 50, end: 60, speech: false }), /넘었습니다/);
    await assert.rejects(rangeCaptions({ input: withAudio, dir: path.join(dir, "w7"), start: 5, end: 5, speech: false }), /시작과 끝/);
    await assert.rejects(rangeCaptions({ input: withAudio, dir: path.join(dir, "w8"), start: -1, end: 5, speech: false }), /시작과 끝/);
    await assert.rejects(rangeCaptions({ input: withAudio, dir: path.join(dir, "w9"), start: 0, end: 200, speech: false }), /초까지만/);
  });
});
