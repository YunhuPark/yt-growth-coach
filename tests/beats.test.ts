// The pure beat helpers, and the analysis on a synthetic drum loop made by ffmpeg (so it needs no music file).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { analyzeBeats, findBeats, NoSoundError } from "../src/lib/editor/beatAnalysis";
import { beatPeriod, beatsWithin, bpmOf, everyNth, nearestBeat, regularity, scaleBeats, shiftBeats, snapToBeats } from "../src/lib/editor/beats";

const grid = (period: number, n: number, from = 0) => Array.from({ length: n }, (_, i) => Math.round((from + i * period) * 1000) / 1000);

describe("tempo and regularity", () => {
  it("reads the tempo from the typical interval", () => {
    assert.equal(beatPeriod(grid(0.5, 20)), 0.5);
    assert.equal(bpmOf(grid(0.5, 20)), 120);
    assert.equal(bpmOf(grid(0.6, 20)), 100);
    assert.equal(bpmOf([1]), 0);
    assert.equal(bpmOf([]), 0);
  });
  it("is near 1 for a steady pulse and low for scattered beats", () => {
    assert.equal(regularity(grid(0.5, 30)), 1);
    const messy = [0, 0.3, 1.1, 1.2, 2.6, 2.7, 3.9, 5.2, 5.3, 6.9];
    assert.ok(regularity(messy) < 0.4, `${regularity(messy)}`);
    assert.equal(regularity([0, 1]), 0);
  });
  it("is not thrown by one missed beat", () => {
    const b = grid(0.5, 30).filter((_, i) => i !== 10);
    assert.ok(regularity(b) > 0.9);
    assert.equal(bpmOf(b), 120);
  });
});

describe("doubling, halving, shifting and picking beats", () => {
  it("doubles by adding a beat halfway, and halves by dropping every other one", () => {
    const b = grid(1, 5);
    assert.deepEqual(scaleBeats(b, "double").slice(0, 5), [0, 0.5, 1, 1.5, 2]);
    assert.equal(bpmOf(scaleBeats(b, "double")), 120);
    assert.deepEqual(scaleBeats(b, "half"), [0, 2, 4]);
    assert.deepEqual(scaleBeats(b, "same"), b);
    assert.deepEqual(scaleBeats([3], "double"), [3]);
  });
  it("shifts all beats and drops what falls before the start", () => {
    assert.deepEqual(shiftBeats([0.1, 0.6, 1.1], -0.2), [0.4, 0.9]);
    assert.deepEqual(shiftBeats([0.1, 0.6], 0.25), [0.35, 0.85]);
  });
  it("takes every Nth beat from a chosen one", () => {
    assert.deepEqual(everyNth(grid(1, 10), 4), [0, 4, 8]);
    assert.deepEqual(everyNth(grid(1, 10), 4, 1), [1, 5, 9]);
    assert.deepEqual(everyNth(grid(1, 4), 1), [0, 1, 2, 3]);
    assert.deepEqual(everyNth(grid(1, 4), 0), [0, 1, 2, 3], "nonsense counts as every beat");
  });
  it("finds the nearest beat", () => {
    assert.equal(nearestBeat(2.4, grid(1, 6)), 2);
    assert.equal(nearestBeat(2.6, grid(1, 6)), 3);
    assert.equal(nearestBeat(5, []), null);
  });
});

describe("snapToBeats", () => {
  const b = grid(0.5, 40, 0.2); // 0.2, 0.7, 1.2 ...
  it("puts both ends on beats and says how many beats lie between", () => {
    const r = snapToBeats(3.0, 9.1, b);
    assert.ok(b.includes(r.start) && b.includes(r.end));
    assert.equal(r.start, 3.2);
    assert.equal(r.end, 9.2);
    assert.equal(r.beats, 12);
  });
  it("keeps a minimum number of beats when both ends would land on the same one", () => {
    const r = snapToBeats(3.0, 3.1, b, 2);
    assert.equal(r.beats, 2);
    assert.equal(r.start, 3.2);
    assert.equal(r.end, 4.2);
  });
  it("leaves the stretch as it is when there are too few beats", () => {
    assert.deepEqual(snapToBeats(1, 5, [2]), { start: 1, end: 5, beats: 0 });
  });
  it("stays inside the beats near the end of the music", () => {
    const r = snapToBeats(19.4, 40, b);
    assert.ok(r.end <= b[b.length - 1] && r.end > r.start);
  });
});

describe("beatsWithin", () => {
  it("gives the beats of a piece as times from its start", () => {
    assert.deepEqual(beatsWithin(grid(0.5, 20), 2, 4), [0, 0.5, 1, 1.5, 2]);
    assert.deepEqual(beatsWithin(grid(0.5, 20), 2.1, 3.1), [0.4, 0.9]);
    assert.deepEqual(beatsWithin([1, 2], 5, 9), []);
  });
});

// ------------------------------------------------------------------ the analysis itself

const FFMPEG = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const FFM = process.env.FFMPEG_PATH || FFMPEG;
const hasFfmpeg = existsSync(FFM);

describe("analyzeBeats on a synthetic drum loop", { skip: !hasFfmpeg ? "needs ffmpeg" : false, timeout: 120_000 }, () => {
  let dir: string;
  const clip = (name: string, bpm: number, seconds: number, audio = true) => {
    const p = 60 / bpm;
    const f = path.join(dir, name);
    // a kick drum (a falling sine, 80 ms long) on every beat
    const kick = `aevalsrc='(lt(mod(t,${p}),0.08))*sin(2*PI*(60+120*exp(-mod(t,${p})*60))*t)*exp(-mod(t,${p})*25)*0.9':d=${seconds}:s=44100`;
    const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=black:s=160x90:r=10:d=${seconds}`];
    if (audio) args.push("-f", "lavfi", "-i", kick, "-shortest");
    args.push("-pix_fmt", "yuv420p", f);
    const r = spawnSync(FFM, args);
    assert.equal(r.status, 0, String(r.stderr));
    return f;
  };
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ytgc-beats-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("finds the tempo and puts the beats where the kicks are", async () => {
    const a = await analyzeBeats(clip("k120.mp4", 120, 24), path.join(dir, "w1"));
    assert.ok(Math.abs(a.bpm - 120) < 1.5, `bpm ${a.bpm}`);
    assert.ok(a.regularity > 0.9, `regularity ${a.regularity}`);
    assert.equal(a.fromSec, 0);
    assert.ok(Math.abs(a.duration - 24) < 0.3);
    // every beat is on the 0.5 s grid of the kicks, within a few hundredths of a second
    for (const b of a.beats) {
      const off = Math.abs(b - Math.round(b / 0.5) * 0.5);
      assert.ok(off < 0.06, `beat at ${b} is ${off} s from a kick`);
    }
    assert.ok(a.beats.length > 35);
  });

  it("works at another tempo", async () => {
    const a = await analyzeBeats(clip("k140.mp4", 140, 24), path.join(dir, "w2"));
    assert.ok(Math.abs(a.bpm - 140) < 2, `bpm ${a.bpm}`);
  });

  it("listens only to the asked stretch and reports times in the whole video", async () => {
    const a = await analyzeBeats(clip("k120b.mp4", 120, 30), path.join(dir, "w3"), { startSec: 10, lengthSec: 12 });
    assert.equal(a.fromSec, 10);
    assert.ok(Math.abs(a.analyzedSec - 12) < 0.01);
    assert.ok(a.beats.every((b) => b >= 9.9 && b <= 22.1), `${a.beats[0]}..${a.beats[a.beats.length - 1]}`);
    assert.ok(Math.abs(a.bpm - 120) < 2);
  });

  it("says so when there is no sound or too little of it", async () => {
    await assert.rejects(analyzeBeats(clip("mute.mp4", 120, 10, false), path.join(dir, "w4")), NoSoundError);
    await assert.rejects(analyzeBeats(clip("short.mp4", 120, 3), path.join(dir, "w5")), /너무 짧/);
  });

  it("returns no beats instead of failing for something it cannot read", () => {
    assert.deepEqual(findBeats(new Float32Array(100)), { beats: [] });
    assert.deepEqual(findBeats(new Float32Array(22050 * 5)), { beats: [] }, "silence has no beats");
  });
});
