// The planning is pure; the rendering uses the real ffmpeg (no network): sounds are synthesized by ffmpeg itself.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  cutPoints,
  DEFAULT_EFFECTS,
  hasEffects,
  MAX_DECORATED,
  normalizeEffects,
  pickCuts,
  planEffects,
  soundGraph,
  transitionFilters,
  type EffectsOpts,
} from "../src/lib/effects";
import { probe, renderVideo } from "../src/lib/render";

process.env.USAGE_LOG = "off";

const opts = (o: Partial<EffectsOpts> = {}): EffectsOpts => ({ ...DEFAULT_EFFECTS, ...o });

describe("normalizeEffects", () => {
  it("fills gaps, drops unknown choices and clamps the volume", () => {
    assert.deepEqual(normalizeEffects(undefined), DEFAULT_EFFECTS);
    const n = normalizeEffects({ transition: "spin" as never, cutSound: "whoosh", hookSound: true, volume: 7 });
    assert.equal(n.transition, "none");
    assert.equal(n.cutSound, "whoosh");
    assert.equal(n.hookSound, true);
    assert.equal(n.volume, 1);
    assert.equal(normalizeEffects({ volume: 0 }).volume, 0.1);
    assert.equal(normalizeEffects({ volume: Number.NaN }).volume, DEFAULT_EFFECTS.volume);
  });
  it("knows when nothing is asked for", () => {
    assert.equal(hasEffects(DEFAULT_EFFECTS), false);
    assert.equal(hasEffects(opts({ hookSound: true })), true);
    assert.equal(hasEffects(opts({ transition: "dip" })), true);
  });
});

describe("cuts", () => {
  const pieces = [{ start: 0, end: 4 }, { start: 10, end: 13 }, { start: 13.2, end: 20 }, { start: 30, end: 33 }];
  it("finds where the pieces meet in the result and how much was skipped before", () => {
    assert.deepEqual(cutPoints(pieces), [
      { t: 4, skippedSec: 6 },
      { t: 7, skippedSec: 0.2 },
      { t: 13.8, skippedSec: 10 },
    ]);
    assert.deepEqual(cutPoints([{ start: 0, end: 5 }]), []);
  });
  it("decorates only cuts that skipped a real stretch, unless asked for all", () => {
    assert.deepEqual(pickCuts(cutPoints(pieces), 16.8, opts({ transition: "flash" })), [4, 13.8]);
    assert.deepEqual(pickCuts(cutPoints(pieces), 16.8, opts({ transition: "flash", allCuts: true })), [4, 7, 13.8]);
  });
  it("keeps decorated cuts apart, off the very ends, and few", () => {
    const close = cutPoints([{ start: 0, end: 2 }, { start: 5, end: 6 }, { start: 9, end: 10 }, { start: 14, end: 20 }]);
    assert.deepEqual(pickCuts(close, 10, opts({ allCuts: true })), [2, 4], "the cut 1 s after another is skipped");
    const many = cutPoints(Array.from({ length: 200 }, (_, i) => ({ start: i * 10, end: i * 10 + 2 })));
    assert.equal(pickCuts(many, 400, opts()).length, MAX_DECORATED);
    assert.deepEqual(pickCuts([{ t: 0.1, skippedSec: 5 }, { t: 19.9, skippedSec: 5 }], 20, opts()), []);
  });
});

describe("filters", () => {
  const size = { w: 1080, h: 1920 };
  it("writes one pulse per cut for a flash and for a dip, and nothing for none", () => {
    assert.deepEqual(transitionFilters("none", [3], size), []);
    assert.deepEqual(transitionFilters("flash", [], size), []);
    const flash = transitionFilters("flash", [3, 9.5], size);
    assert.equal(flash.length, 2);
    assert.match(flash[0], /^eq=brightness='0\.65\*max\(0,1-abs\(t-3\)\/0\.12\)':eval=frame:enable='between\(t,2\.88,3\.12\)'$/);
    const dip = transitionFilters("dip", [3], size);
    assert.match(dip[0], /brightness='-1\*/);
  });
  it("writes one zoom whose factor sums a pulse for every cut, and puts the frame back to its size", () => {
    const f = transitionFilters("punch", [3, 9.5], size);
    assert.equal(f.length, 2);
    assert.match(f[0], /^scale=w='trunc\(iw\*/);
    assert.ok(f[0].includes("gte(t,3)") && f[0].includes("gte(t,9.5)"));
    assert.equal(f[1], "crop=1080:1920");
  });
});

describe("planEffects and soundGraph", () => {
  const pieces = [{ start: 0, end: 4 }, { start: 10, end: 13 }];
  const size = { w: 1080, h: 1920 };
  it("puts the chosen sound at each decorated cut, a pop at the hook and a ding at the ending", () => {
    const plan = planEffects({ pieces, outSec: 7, hook: true, endingFrom: 5 }, opts({ transition: "flash", cutSound: "whoosh", hookSound: true, endingSound: true }), size);
    assert.deepEqual(plan.cuts, [4]);
    assert.deepEqual(plan.sounds, [{ kind: "pop", at: 0 }, { kind: "whoosh", at: 4 }, { kind: "ding", at: 5 }]);
    assert.equal(plan.videoFilters.length, 1);
  });
  it("adds nothing where there is nothing to attach to", () => {
    const plan = planEffects({ pieces: null, outSec: 7, hook: false, endingFrom: null }, opts({ transition: "flash", cutSound: "whoosh", hookSound: true, endingSound: true }), size);
    assert.deepEqual(plan.sounds, []);
    assert.deepEqual(plan.videoFilters, []);
  });
  it("lays the sounds over a base, one source per kind split into the copies used", () => {
    assert.equal(soundGraph([], 0.5, "b", "o"), "");
    const g = soundGraph([{ kind: "whoosh", at: 4 }, { kind: "whoosh", at: 9 }, { kind: "ding", at: 12 }], 0.5, "abase", "aout");
    assert.match(g, /asplit=2\[e0_0\]\[e0_1\]/);
    assert.match(g, /adelay=3800\|3800\[d0_0\]/, "a whoosh starts 0.2 s before its cut");
    assert.match(g, /adelay=12000\|12000\[d1_0\]/);
    assert.match(g, /\[abase\]\[d0_0\]\[d0_1\]\[d1_0\]amix=inputs=4:normalize=0:duration=first/);
    assert.match(g, /\[aout\]$/);
  });
});

// ------------------------------------------------------------------ rendering

const FFMPEG = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const FONTS = ["C:/Windows/Fonts/malgunbd.ttf", "C:/Windows/Fonts/malgun.ttf", "C:/Windows/Fonts/NanumGothic.ttf", "/System/Library/Fonts/AppleSDGothicNeo.ttc", "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf"];
const canRender = existsSync(FFMPEG) && FONTS.some((f) => existsSync(f));

const ff = (args: string[]) => {
  const r = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...args]);
  assert.equal(r.status, 0, String(r.stderr));
  return r;
};
/** An 8x8 gray thumbnail of the frame at `at`, as bytes: enough to tell whether two frames are the same picture. */
const thumb = (file: string, at: number) => [...ff(["-ss", String(at), "-i", file, "-frames:v", "1", "-vf", "scale=8:8", "-pix_fmt", "gray", "-f", "rawvideo", "-"]).stdout];
const mean = (a: number[]) => a.reduce((n, x) => n + x, 0) / a.length;
const diff = (a: number[], b: number[]) => mean(a.map((x, i) => Math.abs(x - b[i])));
/** Mean volume in dB of `len` seconds of audio from `at`. */
const volume = (file: string, at: number, len: number) => {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-ss", String(at), "-t", String(len), "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"]);
  const m = /mean_volume: (-?[\d.]+) dB/.exec(String(r.stderr));
  return m ? Number(m[1]) : Number.NaN;
};

describe("rendering with effects", { skip: !canRender ? "needs the bundled ffmpeg and a font" : false, timeout: 180_000 }, () => {
  let dir: string;
  let src: string; // 10 s, 640x360: a horizontal gradient that moves, with a quiet steady tone
  let silent: string; // 6 s, no audio
  const base = { layout: "short" as const, fit: "blur" as const, captions: [] };
  const cut = { segments: [{ start: 0, end: 3 }, { start: 6, end: 9 }] }; // the cut is at 3 s in the result, 3 s skipped

  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ytgc-fx-"));
    src = path.join(dir, "src.mp4");
    silent = path.join(dir, "silent.mp4");
    ff(["-f", "lavfi", "-i", "color=c=gray:s=640x360:r=25:d=10,geq=lum='80+60*sin(X/50+T)':cb=128:cr=128", "-f", "lavfi", "-i", "sine=frequency=300:duration=10", "-af", "volume=0.05", "-shortest", "-pix_fmt", "yuv420p", src]);
    ff(["-f", "lavfi", "-i", "color=c=gray:s=640x360:r=25:d=6,geq=lum='80+60*sin(X/50+T)':cb=128:cr=128", "-pix_fmt", "yuv420p", silent]);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const make = async (name: string, input: string, o: object) => {
    const out = path.join(dir, name);
    const r = await renderVideo(input, out, { ...base, ...o }, () => {});
    return { r, mp4: path.join(out, "output.mp4"), out };
  };

  it("flashes white at the cut and leaves the rest of the picture alone", async () => {
    const plain = await make("flash0", src, cut);
    const flash = await make("flash1", src, { ...cut, effects: { transition: "flash" } });
    assert.deepEqual(flash.r.effects, { transitions: 1, sounds: 0 });
    assert.ok(diff(thumb(flash.mp4, 3.0), thumb(plain.mp4, 3.0)) > 20, "the cut frame is much brighter");
    assert.ok(diff(thumb(flash.mp4, 1.0), thumb(plain.mp4, 1.0)) < 2, "far from the cut it is the same picture");
    assert.ok(diff(thumb(flash.mp4, 5.0), thumb(plain.mp4, 5.0)) < 2);
  });

  it("dips to black at the cut", async () => {
    const dip = await make("dip", src, { ...cut, effects: { transition: "dip" } });
    assert.ok(mean(thumb(dip.mp4, 3.0)) < 25, "black at the cut");
    assert.ok(mean(thumb(dip.mp4, 1.0)) > 50, "normal elsewhere");
  });

  it("zooms in a little at the cut and not elsewhere, keeping the size", async () => {
    const plain = await make("punch0", src, cut);
    const punch = await make("punch1", src, { ...cut, effects: { transition: "punch" } });
    const info = await probe(punch.mp4, punch.out);
    assert.deepEqual([info.width, info.height], [1080, 1920]);
    assert.ok(diff(thumb(punch.mp4, 3.05), thumb(plain.mp4, 3.05)) > 1.5, "enlarged just after the cut");
    assert.ok(diff(thumb(punch.mp4, 1.0), thumb(plain.mp4, 1.0)) < 1, "unchanged elsewhere");
    assert.ok(diff(thumb(punch.mp4, 5.0), thumb(plain.mp4, 5.0)) < 1);
  });

  it("adds a sound at the cut that is louder than the voice there, and nowhere else", async () => {
    const plain = await make("snd0", src, cut);
    const whoosh = await make("snd1", src, { ...cut, effects: { cutSound: "whoosh", volume: 1 } });
    assert.deepEqual(whoosh.r.effects, { transitions: 0, sounds: 1 });
    assert.ok(volume(whoosh.mp4, 2.8, 0.4) > volume(plain.mp4, 2.8, 0.4) + 6, "louder around the cut");
    assert.ok(Math.abs(volume(whoosh.mp4, 0.3, 0.8) - volume(plain.mp4, 0.3, 0.8)) < 1.5, "the same far from it");
  });

  it("puts a pop at the hook and a ding at the ending, even on a video without sound", async () => {
    const r = await make("stings", silent, {
      hook: { text: "후크", seconds: 2 },
      ending: { text: "끝", seconds: 2 },
      effects: { hookSound: true, endingSound: true, volume: 1 },
    });
    assert.deepEqual(r.r.effects, { transitions: 0, sounds: 2 });
    const info = await probe(r.mp4, r.out);
    assert.equal(info.hasAudio, true, "the effects made an audio track");
    assert.ok(volume(r.mp4, 0, 0.3) > -40, "a pop at the start");
    assert.ok(volume(r.mp4, 2.5, 0.8) < -60, "silence in the middle");
    assert.ok(volume(r.mp4, 4.0, 0.8) > -40, "a ding where the ending starts");
  });

  it("says how many it put in, zero when there was nothing to attach to, and changes nothing without effects", async () => {
    const none = await make("none", src, { trimStart: 1, trimEnd: 6, effects: { transition: "flash", cutSound: "whoosh" } });
    assert.deepEqual(none.r.effects, { transitions: 0, sounds: 0 });
    const off = await make("off", src, cut);
    assert.equal(off.r.effects, undefined);
  });

  it("decorates short pauses only when asked to", async () => {
    const jump = { segments: [{ start: 0, end: 3 }, { start: 3.4, end: 6 }, { start: 6.3, end: 9 }] };
    const some = await make("jump0", src, { ...jump, effects: { transition: "flash" } });
    assert.deepEqual(some.r.effects, { transitions: 0, sounds: 0 });
    const all = await make("jump1", src, { ...jump, effects: { transition: "flash", allCuts: true } });
    assert.deepEqual(all.r.effects, { transitions: 2, sounds: 0 });
  });
});
