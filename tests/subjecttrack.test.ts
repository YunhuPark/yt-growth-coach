// Real ffmpeg, no network and no model: the person finder is replaced by a fake that answers from the picture itself.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { getAutoJob, startAutoReframe } from "../src/lib/editor/autoEditJobs";
import { usedRanges, withAutoReframe } from "../src/lib/editor/autoReframe";
import type { Detector } from "../src/lib/editor/subjectDetector";
import { probe, renderVideo } from "../src/lib/editor/render";
import { assignTracks, samplesFromLooks } from "../src/lib/editor/reframe";
import { mergeRanges, sampleTimes, stepFor, trackSubject, type Track } from "../src/lib/editor/subjectTrack";

process.env.USAGE_LOG = "off";

const FFMPEG = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const hasFfmpeg = existsSync(FFMPEG);
const samplesOf = (t: Track) => samplesFromLooks(assignTracks(t.looks), { target: "person", cropFrac: 0.316 });
const FONTS = ["C:/Windows/Fonts/malgunbd.ttf", "C:/Windows/Fonts/malgun.ttf", "C:/Windows/Fonts/NanumGothic.ttf", "/System/Library/Fonts/AppleSDGothicNeo.ttc", "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf"];
const canRender = hasFfmpeg && FONTS.some((f) => existsSync(f));

const ff = (args: string[]) => {
  const r = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...args]);
  assert.equal(r.status, 0, String(r.stderr));
  return r;
};
/** Average brightness (limited range, 16-235) of an image, or of the frame at `at` seconds of a video. */
const luma = (file: string, at = 0) => ff(["-ss", String(at), "-i", file, "-frames:v", "1", "-vf", "scale=1:1", "-pix_fmt", "gray", "-f", "rawvideo", "-"]).stdout[0];

describe("sampling plan", () => {
  it("merges overlapping and empty ranges", () => {
    assert.deepEqual(mergeRanges([{ start: 5, end: 8 }, { start: 1, end: 3 }, { start: 2, end: 4 }, { start: 9, end: 9 }]), [
      { start: 1, end: 4 },
      { start: 5, end: 8 },
    ]);
  });
  it("looks every half second at most, in the middle of each interval, inside the ranges only", () => {
    assert.deepEqual(sampleTimes([{ start: 1, end: 2 }, { start: 4, end: 5 }], 0.5), [1.25, 1.75, 4.25, 4.75]);
  });
  it("still looks once at a range shorter than a step", () => {
    assert.deepEqual(sampleTimes([{ start: 3, end: 3.2 }], 0.5), [3.1]);
  });
  it("spreads a long video over a fixed number of looks", () => {
    assert.equal(stepFor(60), 0.5);
    assert.equal(stepFor(6000), 10);
  });
  it("takes the parts a render will use", () => {
    assert.deepEqual(usedRanges({ segments: [{ start: 1, end: 2 }, { start: 5, end: 6 }] }, 10), [{ start: 1, end: 2 }, { start: 5, end: 6 }]);
    assert.deepEqual(usedRanges({ trimStart: 2, trimEnd: 7 }, 10), [{ start: 2, end: 7 }]);
    assert.deepEqual(usedRanges({}, 10), [{ start: 0, end: 10 }]);
    assert.deepEqual(usedRanges({ trimEnd: 50 }, 10), [{ start: 0, end: 10 }]);
  });
});

describe("following a subject", { skip: !hasFfmpeg ? "needs the bundled ffmpeg" : false, timeout: 120_000 }, () => {
  let dir: string;
  let ramp: string; // 6 s, 640x360: brightness grows with time, so a still says when it was taken
  let split: string; // 8 s, 640x360: bright left half, dark right half
  let tall: string; // 3 s, 360x640
  let quad: string; // 8 s, 640x360: only the top-left quarter is bright
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ytgc-track-"));
    ramp = path.join(dir, "ramp.mp4");
    split = path.join(dir, "split.mp4");
    tall = path.join(dir, "tall.mp4");
    quad = path.join(dir, "quad.mp4");
    ff(["-f", "lavfi", "-i", "color=c=black:s=640x360:r=10:d=8,geq=lum='if(lt(X,W/2)*lt(Y,H/2),235,20)':cb=128:cr=128", "-pix_fmt", "yuv420p", quad]);
    ff(["-f", "lavfi", "-i", "color=c=black:s=640x360:r=10:d=6,geq=lum='18+T*30':cb=128:cr=128", "-pix_fmt", "yuv420p", ramp]);
    ff(["-f", "lavfi", "-i", "color=c=black:s=640x360:r=10:d=8,geq=lum='if(gt(X,W/2),20,235)':cb=128:cr=128", "-f", "lavfi", "-i", "sine=frequency=300:duration=8", "-shortest", "-pix_fmt", "yuv420p", split]);
    ff(["-f", "lavfi", "-i", "color=c=gray:s=360x640:r=10:d=3", "-pix_fmt", "yuv420p", tall]);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  // The fake "finds a person" at a horizontal place that depends on how bright the still is, that is, on when it was taken.
  const byBrightness: Detector = async (img) => {
    const x = 0.05 + (luma(img) / 255) * 0.9;
    return [{ x0: x - 0.04, y0: 0.2, x1: x + 0.04, y1: 0.9, score: 0.9 }];
  };
  // What byBrightness answers for a picture taken at t, from a still cut straight out at t: the stills under test must match it.
  const expected = async (t: number) => {
    const f = path.join(dir, `ref_${t}.jpg`);
    ff(["-ss", String(t), "-i", ramp, "-frames:v", "1", "-q:v", "4", f]); // made the way the tracker makes its stills
    return (await byBrightness(f))[0].x0 + 0.04;
  };

  it("takes its stills at the right moments, follows the subject and leaves no scratch files", async () => {
    const work = path.join(dir, "w1");
    const t = await trackSubject(ramp, work, { duration: 6, width: 640, height: 360, detector: byBrightness, thumbs: 3 });
    assert.deepEqual(samplesOf(t).map((s) => s.t), [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75, 4.25, 4.75, 5.25, 5.75]);
    const cx = samplesOf(t).map((s) => s.cx ?? NaN);
    for (let i = 1; i < cx.length; i++) assert.ok(cx[i] > cx[i - 1], `still ${i} is not later than the one before`);
    for (const s of samplesOf(t)) assert.ok(Math.abs((s.cx ?? NaN) - (await expected(s.t))) < 0.022, `at ${s.t}: ${s.cx} vs ${await expected(s.t)}`);
    assert.equal(t.thumbs.length, 3);
    assert.match(t.thumbs[0].dataUrl, /^data:image\/jpeg;base64,/);
    assert.deepEqual(readdirSync(work).filter((f) => f.endsWith(".jpg")), []);
  });

  it("looks only inside the ranges that will be used, and at the right place in the file", async () => {
    const work = path.join(dir, "w2");
    const t = await trackSubject(ramp, work, { duration: 6, width: 640, height: 360, ranges: [{ start: 4, end: 5 }, { start: 1, end: 2 }], detector: byBrightness });
    assert.deepEqual(samplesOf(t).map((s) => s.t), [1.25, 1.75, 4.25, 4.75]);
    // a still taken at the wrong moment would be clearly darker or brighter than the clock says
    for (const s of samplesOf(t)) assert.ok(Math.abs((s.cx ?? NaN) - (await expected(s.t))) < 0.022, `at ${s.t}: ${s.cx} vs ${await expected(s.t)}`);
  });

  it("keeps a look with nobody in it as a gap instead of failing", async () => {
    const work = path.join(dir, "w3");
    let n = 0;
    const t = await trackSubject(ramp, work, { duration: 6, width: 640, height: 360, detector: async () => (++n % 2 ? [] : [{ x0: 0.4, y0: 0, x1: 0.6, y1: 1, score: 0.9 }]) });
    assert.equal(samplesOf(t).length, 12);
    assert.equal(samplesOf(t).filter((s) => s.cx === null).length, 6);
  });

  it("builds a camera path for a render and says nothing is needed when it is not", async () => {
    const work = path.join(dir, "w4");
    const wide = await withAutoReframe(ramp, work, { layout: "short", fit: "blur", captions: [] }, { smooth: 3, detector: byBrightness });
    assert.equal(wide.foundPct, 100);
    assert.ok(wide.opts.reframe && wide.opts.reframe.keyframes.length > 10);
    assert.equal(wide.note, undefined);

    const long = await withAutoReframe(ramp, work, { layout: "long", fit: "blur", captions: [] }, { detector: byBrightness });
    assert.equal(long.opts.reframe, undefined);
    assert.match(long.note ?? "", /가로/);

    const vertical = await withAutoReframe(tall, work, { layout: "short", fit: "blur", captions: [] }, { detector: byBrightness });
    assert.equal(vertical.opts.reframe, undefined);
    assert.match(vertical.note ?? "", /세로/);
  });

  it("follows the kind of subject asked for, and zooms by a number or to fit", async () => {
    const work = path.join(dir, "w6");
    const dog: Detector = async () => [
      { x0: 0.6, y0: 0.5, x1: 0.8, y1: 0.8, score: 0.9, label: "dog" },
      { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.9, score: 0.9, label: "person" },
    ];
    const o = { layout: "short" as const, fit: "blur" as const, captions: [] };
    const animal = await withAutoReframe(ramp, work, o, { target: "animal", zoom: 2, detector: dog });
    assert.equal(animal.opts.reframe?.zoom, 2);
    const last = animal.opts.reframe!.keyframes.at(-1)!;
    assert.ok(Math.abs(last.cx - 0.7) < 0.02, `follows the dog, not the person: ${last.cx}`);
    assert.ok(last.cy !== undefined);
    const person = await withAutoReframe(ramp, work, o, { target: "person", detector: dog });
    assert.equal(person.opts.reframe?.zoom, 1);
    assert.ok(Math.abs(person.opts.reframe!.keyframes.at(-1)!.cx - 0.158) < 0.02, "the person is at the left edge; the window cannot go further");
    const fit = await withAutoReframe(ramp, work, o, { target: "animal", zoom: "auto", detector: dog });
    assert.ok((fit.opts.reframe?.zoom ?? 0) > 1 && fit.opts.reframe!.zoom! <= 2, `auto zoom for a dog 30% tall: ${fit.opts.reframe?.zoom}`);
    const none = await withAutoReframe(ramp, work, o, { target: "vehicle", detector: dog });
    assert.equal(none.foundPct, 0);
    assert.match(none.note ?? "", /탈것/);
  });

  it("warns when almost nobody was found", async () => {
    const work = path.join(dir, "w5");
    const r = await withAutoReframe(ramp, work, { layout: "short", fit: "blur", captions: [] }, { detector: async () => [] });
    assert.equal(r.foundPct, 0);
    assert.match(r.note ?? "", /가운데/);
  });

  const waitFor = async (id: string) => {
    let job = getAutoJob(id);
    for (let i = 0; i < 300 && job?.status === "running"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      job = getAutoJob(id);
    }
    return job;
  };

  it("runs as a background job and hands back the samples", async () => {
    const id = "abcdef0123456789";
    startAutoReframe({ id, dir: path.join(dir, "j1"), input: ramp, deleteInput: false, detector: byBrightness });
    const job = await waitFor(id);
    assert.equal(job?.status, "done", job?.error);
    assert.equal(job?.reframe?.looks.length, 12);
    assert.equal(job?.reframe?.width, 640);
    assert.ok(existsSync(ramp), "an input that was not an upload must stay");
    // the job marks itself done and then cleans up, so give the cleanup a moment
    for (let i = 0; i < 40 && existsSync(path.join(dir, "j1")); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(!existsSync(path.join(dir, "j1")), "the working folder is cleaned up");
  });

  it("refuses a video that is already vertical", async () => {
    const id = "abcdef0123456780";
    startAutoReframe({ id, dir: path.join(dir, "j2"), input: tall, deleteInput: false, detector: byBrightness });
    const job = await waitFor(id);
    assert.equal(job?.status, "error");
    assert.match(job?.error ?? "", /세로/);
  });

  describe("render with a camera path", { skip: !canRender ? "needs a font" : false }, () => {
    const base = { layout: "short" as const, fit: "blur" as const, captions: [] };
    const keys = [{ t: 0, cx: 0 }, { t: 3.9, cx: 0 }, { t: 4, cx: 1 }, { t: 8, cx: 1 }];

    it("crops the window to where the path says, over time, and makes a 1080x1920 video", async () => {
      const out = path.join(dir, "r1");
      await renderVideo(split, out, { ...base, reframe: { keyframes: keys } }, () => {});
      const mp4 = path.join(out, "output.mp4");
      const info = await probe(mp4, out);
      assert.deepEqual([info.width, info.height], [1080, 1920]);
      assert.ok(luma(mp4, 1) > 150, "left half is bright");
      assert.ok(luma(mp4, 6) < 80, "right half is dark");
      assert.ok(existsSync(path.join(out, "pan.txt")));
    });

    it("maps the path to the source when pieces are cut out and joined", async () => {
      const out = path.join(dir, "r2");
      // result: source 1-3 (left, bright) then source 5-7 (right, dark); the switch in the result is at 2 s, not at 4
      await renderVideo(split, out, { ...base, segments: [{ start: 1, end: 3 }, { start: 5, end: 7 }], reframe: { keyframes: keys } }, () => {});
      const mp4 = path.join(out, "output.mp4");
      assert.ok(luma(mp4, 1) > 150, "first piece is bright");
      assert.ok(luma(mp4, 3) < 80, "second piece is dark");
    });

    it("maps the path when only the start is trimmed", async () => {
      const out = path.join(dir, "r3");
      await renderVideo(split, out, { ...base, trimStart: 2, trimEnd: 7, reframe: { keyframes: keys } }, () => {});
      const mp4 = path.join(out, "output.mp4");
      assert.ok(luma(mp4, 1) > 150, "source 3 s is bright");
      assert.ok(luma(mp4, 3) < 80, "source 5 s is dark");
    });

    it("zooms in and moves the window up and down as well as sideways", async () => {
      const out = path.join(dir, "r5");
      // zoom 2: the window is a quarter of the picture; it starts on the bright top-left quarter and goes to the bottom-right
      const both = [{ t: 0, cx: 0.1, cy: 0.1 }, { t: 3.9, cx: 0.1, cy: 0.1 }, { t: 4, cx: 0.9, cy: 0.9 }, { t: 8, cx: 0.9, cy: 0.9 }];
      await renderVideo(quad, out, { ...base, reframe: { keyframes: both, zoom: 2 } }, () => {});
      const mp4 = path.join(out, "output.mp4");
      const info = await probe(mp4, out);
      assert.deepEqual([info.width, info.height], [1080, 1920]);
      assert.ok(luma(mp4, 1) > 150, "top-left is bright");
      assert.ok(luma(mp4, 6) < 80, "bottom-right is dark");

      // only the height changes: the left side stays, the window goes from the top (bright) to the bottom (dark)
      const down = path.join(dir, "r6");
      const vertical = [{ t: 0, cx: 0.1, cy: 0.1 }, { t: 3.9, cx: 0.1, cy: 0.1 }, { t: 4, cx: 0.1, cy: 0.9 }, { t: 8, cx: 0.1, cy: 0.9 }];
      await renderVideo(quad, down, { ...base, reframe: { keyframes: vertical, zoom: 2 } }, () => {});
      assert.ok(luma(path.join(down, "output.mp4"), 1) > 150, "top-left is bright");
      assert.ok(luma(path.join(down, "output.mp4"), 6) < 80, "bottom-left is dark");
    });

    it("ignores a path on a horizontal render", async () => {
      const out = path.join(dir, "r4");
      await renderVideo(split, out, { layout: "long", fit: "blur", captions: [], reframe: { keyframes: [{ t: 0, cx: 1 }] } }, () => {});
      const info = await probe(path.join(out, "output.mp4"), out);
      assert.deepEqual([info.width, info.height], [1920, 1080]);
      assert.ok(!existsSync(path.join(out, "pan.txt")));
    });
  });
});
