// The pure beat helpers, and the analysis on a synthetic drum loop made by ffmpeg (so it needs no music file).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { analyzeBeats, findBeats, loudnessOf, NoSoundError } from "../src/lib/editor/beatAnalysis";
import { renderVideo } from "../src/lib/editor/render";
import { withBeatEffects } from "../src/lib/editor/beatEffects";
import type { BeatAnalysis } from "../src/lib/editor/beatAnalysis";
import { beatPeriod, beatsInResult, beatTrust, beatsWithin, bpmOf, everyNth, loudnessBetween, nearestBeat, planBeatCuts, regularity, scaleBeats, shiftBeats, snapToBeats, supportOf } from "../src/lib/editor/beats";

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

describe("support and trust", () => {
  it("is the share of beats with an onset close by", () => {
    const beats = [1, 2, 3, 4];
    assert.equal(supportOf(beats, [1.01, 2.02, 2.97, 4.05]), 1);
    assert.equal(supportOf(beats, [1.01, 2.5]), 0.25);
    assert.equal(supportOf(beats, []), 0);
    assert.equal(supportOf([], [1]), 0);
    assert.equal(supportOf(beats, [0.5, 1.5, 2.5, 3.5]), 0, "onsets between the beats do not count");
  });
  it("trusts beats that are even and on onsets, and only those", () => {
    assert.equal(beatTrust(1, 1), "high");
    assert.equal(beatTrust(0.98, 0.64), "medium", "even but mostly filled in");
    assert.equal(beatTrust(0.72, 0.95), "medium");
    assert.equal(beatTrust(0.3, 0.9), "low");
    assert.equal(beatTrust(0.9, 0.4), "low");
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

describe("planBeatCuts and beatsInResult", () => {
  const b = grid(0.5, 121, 0.2); // 60 s of 120 BPM, first beat at 0.2
  it("takes pieces of whole bars evenly across the stretch, each starting and ending on a beat", () => {
    const p = planBeatCuts(b, 0, 60.2, 4, 10); // 2 s per piece -> 5 pieces
    assert.equal(p.length, 5);
    for (const x of p) {
      assert.ok(b.includes(x.start) && b.includes(x.end));
      assert.ok(Math.abs(x.end - x.start - 2) < 1e-6);
      assert.ok(Math.abs(((x.start - 0.2) / 2) % 1) < 1e-6, "starts on a bar line counted from the first beat");
    }
    assert.equal(p[0].start, 0.2);
    assert.ok(p[4].end <= 60.2);
    for (let i = 1; i < p.length; i++) assert.ok(p[i].start >= p[i - 1].end, "no overlap");
  });
  it("gives the whole stretch when the target is long, and one piece for a very short target", () => {
    const all = planBeatCuts(b, 0, 60.2, 4, 999);
    assert.equal(all.length, 30);
    assert.equal(all[0].start, 0.2);
    assert.equal(all[29].end, 60.2);
    assert.equal(planBeatCuts(b, 0, 60.2, 4, 0.5).length, 1);
  });
  it("gives nothing when there are too few beats", () => {
    assert.deepEqual(planBeatCuts([1, 1.5, 2], 0, 3, 4, 10), []);
    assert.deepEqual(planBeatCuts([], 0, 3, 4, 10), []);
  });
  it("can take the loudest pieces instead, in their original order", () => {
    // 60 s, quiet except 30..40 s
    const values = Array.from({ length: 240 }, (_, i) => (i * 0.25 >= 30 && i * 0.25 < 40 ? 0.5 : 0.05));
    const loudness = { fromSec: 0, stepSec: 0.25, values };
    const p = planBeatCuts(b, 0, 60.2, 4, 10, { by: "loud", loudness });
    assert.equal(p.length, 5);
    assert.ok(p.every((x) => x.start >= 29.9 && x.end <= 40.3), JSON.stringify(p));
    for (let i = 1; i < p.length; i++) assert.ok(p[i].start >= p[i - 1].end);
    // a target as long as the stretch makes the choice moot
    assert.equal(planBeatCuts(b, 0, 60.2, 4, 999, { by: "loud", loudness }).length, 30);
  });
  it("reads the mean strength between two times", () => {
    const l = { fromSec: 10, stepSec: 0.5, values: [0.1, 0.1, 0.9, 0.9] };
    assert.ok(Math.abs(loudnessBetween(l, 10, 11) - 0.1) < 1e-9);
    assert.ok(Math.abs(loudnessBetween(l, 11, 12) - 0.9) < 1e-9);
    assert.ok(Math.abs(loudnessBetween(l, 10.5, 11.5) - 0.5) < 1e-9);
    assert.equal(loudnessBetween({ fromSec: 0, stepSec: 1, values: [] }, 0, 5), 0);
    assert.equal(loudnessBetween(l, 100, 101), 0, "no data past the end");
  });
  it("keeps the pulse steady across the joins in the result", () => {
    const p = planBeatCuts(b, 0, 60.2, 4, 10);
    const r = beatsInResult(p, b);
    assert.equal(r.length, 21, "4 beats from each of 5 pieces, and the closing beat of the last");
    assert.deepEqual(r.slice(0, 5), [0, 0.5, 1, 1.5, 2]);
    for (let i = 1; i < r.length; i++) assert.ok(Math.abs(r[i] - r[i - 1] - 0.5) < 1e-6, `gap at ${i}`);
  });
  it("includes the last beat of the last piece only", () => {
    const r = beatsInResult([{ start: 1, end: 2 }, { start: 5, end: 6 }], [1, 1.5, 2, 5, 5.5, 6]);
    assert.deepEqual(r, [0, 0.5, 1, 1.5, 2]);
  });
});

// ------------------------------------------------------------------ the analysis itself

const FFMPEG = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const FFM = process.env.FFMPEG_PATH || FFMPEG;
const hasFfmpeg = existsSync(FFM);
const FONTS = ["C:/Windows/Fonts/malgunbd.ttf", "C:/Windows/Fonts/malgun.ttf", "C:/Windows/Fonts/NanumGothic.ttf", "/System/Library/Fonts/AppleSDGothicNeo.ttc", "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf"];
const canRender = hasFfmpeg && FONTS.some((f) => existsSync(f));
process.env.USAGE_LOG = "off";

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
    assert.ok(a.support >= 0.9, `support ${a.support}`);
    assert.equal(beatTrust(a.regularity, a.support), "high");
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

  it("does not trust the beats it finds in a tone that merely switches on and off", async () => {
    const f = path.join(dir, "gated.mp4");
    const r = spawnSync(FFM, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=160x90:r=10:d=40", "-f", "lavfi", "-i", "sine=frequency=220:duration=40", "-af", "volume='if(lt(mod(t,4),2.2),0.5,0)':eval=frame", "-shortest", "-pix_fmt", "yuv420p", f]);
    assert.equal(r.status, 0, String(r.stderr));
    const a = await analyzeBeats(f, path.join(dir, "w7"));
    assert.notEqual(beatTrust(a.regularity, a.support), "high", `regularity ${a.regularity}, support ${a.support}`);
  });

  it("measures how loud each part of the sound is", async () => {
    const p = 0.5;
    const amp = "if(between(t,20,40),0.9,0.15)";
    const kick = `aevalsrc='(lt(mod(t,${p}),0.08))*sin(2*PI*(60+120*exp(-mod(t,${p})*60))*t)*exp(-mod(t,${p})*25)*${amp}':d=60:s=44100`;
    const f = path.join(dir, "loud.mp4");
    const r = spawnSync(FFM, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=160x90:r=10:d=60", "-f", "lavfi", "-i", kick, "-shortest", "-pix_fmt", "yuv420p", f]);
    assert.equal(r.status, 0, String(r.stderr));
    const a = await analyzeBeats(f, path.join(dir, "w6"));
    assert.equal(a.loudness.stepSec, 0.25);
    assert.ok(loudnessBetween(a.loudness, 22, 38) > 3 * loudnessBetween(a.loudness, 2, 18), "the loud middle is much louder");
    const picked = planBeatCuts(a.beats, 0, a.duration, 4, 10, { by: "loud", loudness: a.loudness });
    assert.ok(picked.length >= 4 && picked.every((x) => x.start >= 19.5 && x.end <= 40.5), JSON.stringify(picked));
  });

  it("returns no beats instead of failing for something it cannot read", () => {
    assert.equal(loudnessOf(new Float32Array(0), 3).values.length, 0);
    assert.deepEqual(findBeats(new Float32Array(100)), { beats: [], support: 0 });
    assert.deepEqual(findBeats(new Float32Array(22050 * 5)), { beats: [], support: 0 }, "silence has no beats");
  });
});

describe("a beat montage keeps the pulse", { skip: !canRender ? "needs ffmpeg and a font" : false, timeout: 240_000 }, () => {
  it("is still a steady 120 BPM after pieces from all over a 60 s clip are joined", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ytgc-montage-"));
    try {
      const p = 0.5;
      const kick = `aevalsrc='(lt(mod(t,${p}),0.08))*sin(2*PI*(60+120*exp(-mod(t,${p})*60))*t)*exp(-mod(t,${p})*25)*0.9':d=60:s=44100`;
      const src = path.join(dir, "src.mp4");
      const r = spawnSync(FFM, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=15:d=60", "-f", "lavfi", "-i", kick, "-shortest", "-pix_fmt", "yuv420p", src]);
      assert.equal(r.status, 0, String(r.stderr));

      const found = await analyzeBeats(src, path.join(dir, "w1"));
      const pieces = planBeatCuts(found.beats, 0, found.duration, 4, 12);
      assert.ok(pieces.length >= 5, `${pieces.length} pieces`);
      const times = beatsInResult(pieces, found.beats);
      const out = path.join(dir, "out");
      const res = await renderVideo(src, out, { layout: "long", fit: "blur", captions: [], segments: pieces, effects: { transition: "flash", cutSound: "tick", beatTimes: times } }, () => {});
      assert.ok(res.effects && res.effects.transitions > 10);

      const again = await analyzeBeats(path.join(out, "output.mp4"), path.join(dir, "w2"));
      assert.ok(Math.abs(again.bpm - 120) < 3, `bpm ${again.bpm}`);
      assert.ok(again.regularity > 0.85, `regularity ${again.regularity}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("withBeatEffects", { skip: !hasFfmpeg ? "needs ffmpeg" : false, timeout: 240_000 }, () => {
  let dir: string;
  let drum: string;
  let mute: string;
  const make = (name: string, audio: boolean) => {
    const p = 0.5;
    const kick = `aevalsrc='(lt(mod(t,${p}),0.08))*sin(2*PI*(60+120*exp(-mod(t,${p})*60))*t)*exp(-mod(t,${p})*25)*0.9':d=30:s=44100`;
    const f = path.join(dir, name);
    const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=160x90:r=10:d=30"];
    if (audio) args.push("-f", "lavfi", "-i", kick, "-shortest");
    const r = spawnSync(FFM, [...args, "-pix_fmt", "yuv420p", f]);
    assert.equal(r.status, 0, String(r.stderr));
    return f;
  };
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ytgc-be-"));
    drum = make("drum.mp4", true);
    mute = make("mute.mp4", false);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const base = { layout: "long" as const, fit: "blur" as const, captions: [] };

  it("does nothing unless beats were asked for, or there is no effect to place", async () => {
    const a = await withBeatEffects(drum, dir, { ...base, effects: { transition: "flash" } });
    assert.equal(a.beats, null);
    const b = await withBeatEffects(drum, dir, { ...base, effects: { onBeats: true } });
    assert.equal(b.beats, null, "nothing to put on the beats");
  });

  it("puts the beats of the used parts, as times in the result, into the effects", async () => {
    const segments = [{ start: 2, end: 6 }, { start: 14, end: 18 }];
    const r = await withBeatEffects(drum, dir, { ...base, segments, effects: { transition: "flash", cutSound: "tick", onBeats: true } });
    const t = r.opts.effects?.beatTimes ?? [];
    assert.ok(t.length >= 14 && t.length <= 18, `${t.length} beats in 8 s of 120 BPM`);
    assert.ok(t.every((x) => x >= 0 && x <= 8.05));
    assert.ok(t.some((x) => x < 4) && t.some((x) => x > 4.2), "beats of both pieces");
    assert.match(r.note ?? "", /1[12]\d BPM/);
    // they land on the kicks of the source, shifted into the result: every kick is on a multiple of 0.5 s in the source
    for (const x of t) {
      const src = x < 4 ? 2 + x : 14 + (x - 4);
      assert.ok(Math.abs(src - Math.round(src / 0.5) * 0.5) < 0.07, `result ${x} is source ${src}`);
    }
  });

  it("works in a folder that does not exist yet, as in a real render", async () => {
    const fresh = path.join(dir, "not", "yet");
    const r = await withBeatEffects(drum, fresh, { ...base, effects: { transition: "flash", onBeats: true } });
    assert.ok((r.beats ?? 0) > 30, `${r.beats}`);
  });

  it("takes every Nth beat", async () => {
    const all = await withBeatEffects(drum, dir, { ...base, effects: { transition: "flash", onBeats: true, beatEvery: 1 } });
    const four = await withBeatEffects(drum, dir, { ...base, effects: { transition: "flash", onBeats: true, beatEvery: 4 } });
    const n1 = all.opts.effects?.beatTimes?.length ?? 0;
    const n4 = four.opts.effects?.beatTimes?.length ?? 0;
    assert.ok(n1 > 50 && Math.abs(n4 - Math.ceil(n1 / 4)) <= 1, `${n1} and ${n4}`);
  });

  it("falls back to the cuts, and says so, for a video without sound or without a steady beat", async () => {
    const m = await withBeatEffects(mute, dir, { ...base, effects: { transition: "flash", onBeats: true } });
    assert.equal(m.opts.effects?.onBeats, false);
    assert.equal(m.opts.effects?.beatTimes, undefined);
    assert.match(m.note ?? "", /컷에 넣었습니다/);
    const weak = async () => ({ duration: 30, fromSec: 0, analyzedSec: 30, bpm: 90, beats: [1, 1.2, 2.4, 2.5, 4, 4.1, 5.9, 6, 7.7, 8.5, 9], regularity: 0.2, support: 0.3, loudness: { fromSec: 0, stepSec: 0.25, values: [] } }) as BeatAnalysis;
    const w = await withBeatEffects(drum, dir, { ...base, effects: { transition: "flash", onBeats: true } }, { analyze: weak });
    assert.match(w.note ?? "", /뚜렷하지 않/);
    assert.equal(w.opts.effects?.onBeats, false);
  });
});
