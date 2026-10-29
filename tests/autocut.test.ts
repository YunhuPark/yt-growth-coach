// Real ffmpeg, no network: the speech engine is replaced by a fake that answers with chosen words.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { detectSilences } from "../src/lib/editor/analyzeVideo";
import { getAutoJob, startAutoCut } from "../src/lib/editor/autoEditJobs";
import { keepSegments, planRemovals, DEFAULT_CUT_OPTIONS } from "../src/lib/editor/cutPlan";
import { probe, renderVideo } from "../src/lib/editor/render";
import { transcribeWords, type Transcriber } from "../src/lib/editor/transcribe";

process.env.USAGE_LOG = "off"; // do not write measurements into the real .data folder

const FFMPEG = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const FONTS = ["C:/Windows/Fonts/malgunbd.ttf", "C:/Windows/Fonts/malgun.ttf", "C:/Windows/Fonts/NanumGothic.ttf", "/System/Library/Fonts/AppleSDGothicNeo.ttc", "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf"];
const hasFfmpeg = existsSync(FFMPEG);
const canRender = hasFfmpeg && FONTS.some((f) => existsSync(f));

describe("transcribeWords", { skip: !hasFfmpeg ? "needs the bundled ffmpeg" : false, timeout: 60_000 }, () => {
  let dir: string;
  let src: string;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ytgc-words-"));
    src = path.join(dir, "a.mp4");
    const r = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=20", "-f", "lavfi", "-i", "color=s=64x64:r=5:d=20", "-shortest", "-pix_fmt", "yuv420p", src]);
    assert.equal(r.status, 0, String(r.stderr));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("asks for word times, puts them back at their place in the file, and keeps repeats that sentence filtering would drop", async () => {
    let asked = false;
    const fake: Transcriber = async (_s, o) => {
      asked = !!o.words;
      return [
        { start: 0.5, end: 1, text: " 음 " },
        { start: 1, end: 1.6, text: "음" },
        { start: 2, end: 2.4, text: "\uFFFD" },
        { start: 3, end: 3.5, text: "안녕" },
      ];
    };
    const r = await transcribeWords(src, path.join(dir, "w"), { duration: 20, silences: [{ start: 5, end: 12 }], transcriber: fake });
    assert.equal(asked, true);
    // two stretches with sound (0-5 and 12-20), the same fake answer for each; the second is shifted by its start
    assert.deepEqual(r.words.map((w) => w.text), ["음", "음", "안녕", "음", "음", "안녕"]);
    const second = r.words.filter((w) => w.start > 11);
    assert.ok(second.length === 3 && Math.abs(second[0].start - (0.5 + 11.7)) < 0.4, `got ${JSON.stringify(second)}`);
    assert.equal(r.truncated, false);
  });

  it("says when the file is longer than the part it listens to", async () => {
    const r = await transcribeWords(src, path.join(dir, "w2"), { duration: 3 * 3600, silences: [], transcriber: async () => [] });
    assert.equal(r.truncated, true);
  });
});

describe("detectSilences", { skip: !hasFfmpeg ? "needs the bundled ffmpeg" : false, timeout: 60_000 }, () => {
  let dir: string;
  let gappy: string;
  let silentFile: string;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ytgc-sil-"));
    gappy = path.join(dir, "gappy.mp4");
    // 12 s: tone 0-3, quiet 3-6, tone 6-9, a faint hum 9-10 (about -44 dB), tone 10-12
    const r = spawnSync(FFMPEG, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=s=64x64:r=5:d=12",
      "-f", "lavfi", "-i", "sine=frequency=300:duration=12",
      "-filter_complex", "[1:a]volume='if(between(t,3,6),0,if(between(t,9,10),0.05,1))':eval=frame[a]",
      "-map", "0:v", "-map", "[a]", "-shortest", "-pix_fmt", "yuv420p", gappy,
    ]);
    assert.equal(r.status, 0, String(r.stderr));
    silentFile = path.join(dir, "nosound.mp4");
    const r2 = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=s=64x64:r=5:d=3", "-pix_fmt", "yuv420p", silentFile]);
    assert.equal(r2.status, 0, String(r2.stderr));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("finds the quiet stretches at the given threshold and length", async () => {
    const a = await detectSilences(gappy, path.join(dir, "a"), { noiseDb: -35, minSec: 0.3 });
    assert.equal(a.hasAudio, true);
    assert.ok(Math.abs(a.duration - 12) < 0.3);
    assert.ok(a.silences.some((s) => Math.abs(s.start - 3) < 0.2 && Math.abs(s.end - 6) < 0.2), JSON.stringify(a.silences));
    assert.ok(a.silences.some((s) => s.start > 8.7 && s.end < 10.3), "the faint hum counts as quiet at -35 dB");
  });

  it("is stricter or looser as the threshold moves, and ignores stretches shorter than the minimum", async () => {
    const strict = await detectSilences(gappy, path.join(dir, "b"), { noiseDb: -55, minSec: 0.3 });
    assert.ok(!strict.silences.some((s) => s.start > 8.7 && s.end < 10.3), "at -55 dB the hum is not silence");
    assert.ok(strict.silences.some((s) => Math.abs(s.start - 3) < 0.2), "the true silence still is");
    const long = await detectSilences(gappy, path.join(dir, "c"), { noiseDb: -35, minSec: 2 });
    assert.equal(long.silences.length, 1, "only the 3 s silence is long enough");
  });

  it("reports a file without sound instead of failing", async () => {
    const r = await detectSilences(silentFile, path.join(dir, "d"), { noiseDb: -35, minSec: 0.3 });
    assert.equal(r.hasAudio, false);
    assert.deepEqual(r.silences, []);
  });

  it("turns into a plan that keeps the sound and drops the quiet part", async () => {
    const found = await detectSilences(gappy, path.join(dir, "e"), { noiseDb: -35, minSec: 0.3 });
    const removals = planRemovals(found.silences, [], { ...DEFAULT_CUT_OPTIONS, silence: { ...DEFAULT_CUT_OPTIONS.silence, minSec: 0.6, keepSec: 0.2 } });
    const kept = keepSegments(found.duration, removals);
    const total = kept.reduce((n, s) => n + s.end - s.start, 0);
    assert.ok(total < 12 - 3.5 && total > 12 - 5.5, `kept ${total}s of 12`);
  });
});

describe("the auto-cut job", { skip: !hasFfmpeg ? "needs the bundled ffmpeg" : false, timeout: 90_000 }, () => {
  let dir: string;
  let gappy: string;
  let silentFile: string;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ytgc-job-"));
    gappy = path.join(dir, "g.mp4");
    const r = spawnSync(FFMPEG, [
      "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=s=64x64:r=5:d=10", "-f", "lavfi", "-i", "sine=frequency=300:duration=10",
      "-filter_complex", "[1:a]volume='if(between(t,3,6),0,1)':eval=frame[a]", "-map", "0:v", "-map", "[a]", "-shortest", "-pix_fmt", "yuv420p", gappy,
    ]);
    assert.equal(r.status, 0, String(r.stderr));
    silentFile = path.join(dir, "s.mp4");
    const r2 = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=s=64x64:r=5:d=3", "-pix_fmt", "yuv420p", silentFile]);
    assert.equal(r2.status, 0, String(r2.stderr));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const finished = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const j = getAutoJob(id);
      if (j && j.status !== "running") return j;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("job did not finish");
  };

  it("returns the silences, and the words when asked, then removes its scratch folder", async () => {
    const work = path.join(dir, "j1");
    startAutoCut({
      id: "a".repeat(16), dir: work, input: gappy, deleteInput: false, noiseDb: -35, fillers: true,
      transcriber: async () => [{ start: 0.2, end: 0.8, text: "음" }],
    });
    const j = await finished("a".repeat(16));
    assert.equal(j.status, "done", j.error);
    assert.ok(Math.abs(j.cut!.duration - 10) < 0.3);
    assert.ok(j.cut!.silences.some((s) => Math.abs(s.start - 3) < 0.2));
    assert.equal(j.cut!.fillersAnalyzed, true);
    assert.ok(j.cut!.words.some((w) => w.text === "음"));
    // the job marks itself done and then cleans up, so give the cleanup a moment
    for (let i = 0; i < 40 && existsSync(work); i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(existsSync(work), false, "the scratch folder is gone");
    assert.equal(existsSync(gappy), true, "a file given by path is never deleted");
  });

  it("does not load the speech model unless filler words were asked for", async () => {
    startAutoCut({
      id: "b".repeat(16), dir: path.join(dir, "j2"), input: gappy, deleteInput: false, noiseDb: -35, fillers: false,
      transcriber: async () => {
        throw new Error("must not be called");
      },
    });
    const j = await finished("b".repeat(16));
    assert.equal(j.status, "done", j.error);
    assert.deepEqual(j.cut!.words, []);
    assert.equal(j.cut!.fillersAnalyzed, false);
  });

  it("fails clearly for a video with no sound", async () => {
    startAutoCut({ id: "c".repeat(16), dir: path.join(dir, "j3"), input: silentFile, deleteInput: false, noiseDb: -35, fillers: false });
    const j = await finished("c".repeat(16));
    assert.equal(j.status, "error");
    assert.match(j.error!, /소리가 없어/);
  });
});

describe("rendering many cuts", { skip: !canRender ? "needs the bundled ffmpeg and a Korean font" : false, timeout: 180_000 }, () => {
  let dir: string;
  let src: string;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ytgc-many-"));
    src = path.join(dir, "src.mp4");
    const r = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=10:d=60", "-f", "lavfi", "-i", "sine=frequency=330:duration=60", "-shortest", "-pix_fmt", "yuv420p", src]);
    assert.equal(r.status, 0, String(r.stderr));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("joins a few hundred pieces into one video as long as the pieces together, with sound", async () => {
    // 200 pieces of 0.2 s every 0.3 s: 40 s kept out of 60
    const segments = Array.from({ length: 200 }, (_, i) => ({ start: i * 0.3, end: i * 0.3 + 0.2 }));
    const t0 = Date.now();
    const r = await renderVideo(src, path.join(dir, "out"), { layout: "long", fit: "blur", segments, captions: [] });
    assert.ok(Math.abs(r.durationSec - 40) < 0.2, `got ${r.durationSec}`);
    const info = await probe(path.join(dir, "out", "output.mp4"), dir);
    assert.ok(Math.abs(info.duration - 40) < 0.6, `file is ${info.duration}s`);
    assert.equal(info.hasAudio, true);
    assert.ok(Date.now() - t0 < 120_000, "a few hundred cuts render in reasonable time");
  });
});
