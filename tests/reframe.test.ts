import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chooseTarget, cropFraction, cropWidthPx, cropX, cxAt, dedupeBoxes, panScript, smoothPath, trackStats, type Box, type Sample } from "../src/lib/reframe";

const box = (x0: number, x1: number, score = 0.9, y0 = 0.2, y1 = 0.9): Box => ({ x0, x1, y0, y1, score });

describe("crop geometry", () => {
  it("a 9:16 window of a 16:9 picture covers about a third of its width", () => {
    assert.ok(Math.abs(cropFraction(1920, 1080) - 0.31640625) < 1e-9);
    assert.equal(cropFraction(1080, 1920), 1, "a vertical picture is already that narrow");
    assert.equal(cropFraction(0, 0), 1);
  });

  it("is an even number of pixels, never wider than the picture", () => {
    assert.equal(cropWidthPx(1920, 1080), 608);
    assert.equal(cropWidthPx(1280, 720), 406);
    assert.equal(cropWidthPx(300, 1080), 300);
  });

  it("puts the window's left edge so it is centred, even, and inside the picture", () => {
    assert.equal(cropX(0.5, 1920, 608), 656);
    assert.equal(cropX(0, 1920, 608), 0, "cannot go off the left edge");
    assert.equal(cropX(1, 1920, 608), 1312, "cannot go off the right edge");
    assert.equal(cropX(0.3, 1920, 608) % 2, 0);
  });
});

describe("dedupeBoxes", () => {
  it("drops weak detections and keeps the more confident of two boxes on the same person", () => {
    const out = dedupeBoxes([box(0.4, 0.6, 0.7), box(0.41, 0.61, 0.95), box(0.1, 0.2, 0.3), box(0.8, 0.9, 0.9)]);
    assert.deepEqual(out.map((b) => [b.x0, b.score]), [[0.41, 0.95], [0.8, 0.9]]);
  });

  it("keeps two people who only touch", () => {
    assert.equal(dedupeBoxes([box(0.1, 0.4), box(0.4, 0.7)]).length, 2);
  });
});

describe("chooseTarget", () => {
  const frac = 0.316;
  it("is null when nobody is found", () => {
    assert.equal(chooseTarget([], null, frac), null);
    assert.equal(chooseTarget([box(0.4, 0.6, 0.2)], null, frac), null);
  });

  it("centres on one person", () => {
    assert.equal(chooseTarget([box(0.6, 0.8)], null, frac), 0.7);
  });

  it("centres on the group when everyone fits in the window", () => {
    assert.equal(chooseTarget([box(0.4, 0.5), box(0.55, 0.65)], null, frac), 0.525);
  });

  it("picks the most prominent person when the group is too wide for the window", () => {
    const small = box(0.05, 0.15, 0.9, 0.4, 0.6);
    const big = box(0.6, 0.9, 0.95, 0.1, 0.95);
    assert.equal(chooseTarget([small, big], null, frac), 0.75);
  });

  it("sticks with whoever was followed a moment ago when two people are about equally prominent", () => {
    const left = box(0.1, 0.3, 0.9);
    const right = box(0.7, 0.9, 0.92);
    assert.equal(chooseTarget([left, right], 0.2, frac), 0.2);
    assert.equal(chooseTarget([left, right], 0.8, frac), 0.8);
  });
});

describe("smoothPath", () => {
  const still = (cx: number, secs: number): Sample[] => Array.from({ length: secs * 2 + 1 }, (_, i) => ({ t: i / 2, cx }));
  const frac = 0.316;

  it("holds still on a subject that does not move", () => {
    const p = smoothPath(still(0.6, 10), { cropFrac: frac, duration: 10, smooth: 3 });
    assert.equal(p.length, 101);
    assert.ok(p.every((k) => Math.abs(k.cx - p[0].cx) < 0.001), "no drift");
    assert.ok(Math.abs(p[0].cx - 0.6) < 0.001);
  });

  it("stays put while the subject wanders inside the dead zone", () => {
    const wander = Array.from({ length: 21 }, (_, i) => ({ t: i / 2, cx: 0.5 + (i % 2 ? 0.02 : -0.02) }));
    const p = smoothPath(wander, { cropFrac: frac, duration: 10, smooth: 3 });
    const xs = p.map((k) => k.cx);
    assert.ok(Math.max(...xs) - Math.min(...xs) < 0.005, "the camera did not shake along with the small movements");
  });

  it("follows a subject that walks across the picture, a little behind it, never leaving the picture", () => {
    const walk = Array.from({ length: 21 }, (_, i) => ({ t: i / 2, cx: 0.3 + i * 0.02 }));
    const p = smoothPath(walk, { cropFrac: frac, duration: 10, smooth: 2 });
    assert.ok(p[p.length - 1].cx > 0.55, "ended up near the subject");
    assert.ok(p.every((k) => k.cx >= frac / 2 - 1e-6 && k.cx <= 1 - frac / 2 + 1e-6));
    for (let i = 1; i < p.length; i++) assert.ok(p[i].cx >= p[i - 1].cx - 1e-9, "never moves backwards for a subject moving one way");
  });

  it("never pans faster than the smoothness allows", () => {
    // the subject runs across the picture, in steps too small to be taken for a cut
    const run: Sample[] = [0.2, 0.2, 0.4, 0.6, 0.8, 0.8, 0.8, 0.8].map((cx, i) => ({ t: i * 0.5, cx }));
    const fast = smoothPath(run, { cropFrac: frac, duration: 4, smooth: 1, hz: 20 });
    const slow = smoothPath(run, { cropFrac: frac, duration: 4, smooth: 5, hz: 20 });
    const maxMove = (p: { cx: number }[]) => Math.max(...p.slice(1).map((k, i) => Math.abs(k.cx - p[i].cx))) * 20;
    assert.ok(maxMove(slow) <= 0.18 + 1e-6, `slowest setting moved ${maxMove(slow)} per second`);
    assert.ok(maxMove(fast) <= 1.2 + 1e-6);
    assert.ok(maxMove(fast) > maxMove(slow), "the quick setting really is quicker");
  });

  it("jumps with a cut in the video instead of sliding across it", () => {
    // the subject is at 0.25, then the picture cuts to a shot where they are at 0.75 and stay there
    const cut: Sample[] = [0, 0.5, 1, 1.5, 2].map((t, i) => ({ t, cx: i < 3 ? 0.25 : 0.75 }));
    const p = smoothPath(cut, { cropFrac: frac, duration: 4, smooth: 5, hz: 10 });
    const after = p.find((k) => k.t >= 1.5)!;
    assert.ok(Math.abs(after.cx - 0.75) < 0.01, `at the cut the camera was at ${after.cx}`);
  });

  it("ignores one stray look that is not a cut", () => {
    const s = still(0.5, 6);
    s[6] = { t: 3, cx: 0.9 }; // a wrong detection for one look
    const p = smoothPath(s, { cropFrac: frac, duration: 6, smooth: 3 });
    assert.ok(p.every((k) => Math.abs(k.cx - 0.5) < 0.01));
  });

  it("holds the last place when nobody is found for a moment, then settles toward the middle", () => {
    const s: Sample[] = [
      { t: 0, cx: 0.7 }, { t: 1, cx: 0.7 },
      ...Array.from({ length: 30 }, (_, i) => ({ t: 2 + i, cx: null })),
    ];
    const p = smoothPath(s, { cropFrac: frac, duration: 31, smooth: 3 });
    assert.ok(Math.abs(p.find((k) => k.t === 2.5)!.cx - 0.7) < 0.02, "still looking where they were");
    assert.ok(p[p.length - 1].cx < 0.6, "drifted back toward the middle");
  });

  it("takes the first sighting for the start when the first looks found nobody", () => {
    const s: Sample[] = [{ t: 0, cx: null }, { t: 0.5, cx: null }, { t: 1, cx: 0.62 }, { t: 1.5, cx: 0.62 }];
    const p = smoothPath(s, { cropFrac: frac, duration: 1.5, smooth: 3 });
    assert.ok(Math.abs(p[0].cx - 0.62) < 0.01);
  });

  it("stays in the middle when asked to, when there is nothing to follow, or when the picture is already narrow", () => {
    const walk = still(0.2, 4);
    assert.ok(smoothPath(walk, { cropFrac: frac, duration: 4, smooth: 3, fixed: true }).every((k) => k.cx === 0.5));
    assert.ok(smoothPath([], { cropFrac: frac, duration: 4, smooth: 3 }).every((k) => k.cx === 0.5));
    assert.ok(smoothPath(walk, { cropFrac: 1, duration: 4, smooth: 3 }).every((k) => k.cx === 0.5));
  });
});

describe("trackStats", () => {
  it("says how much of the path rests on sightings", () => {
    assert.deepEqual(trackStats([{ t: 0, cx: 0.5 }, { t: 1, cx: null }, { t: 2, cx: 0.4 }, { t: 3, cx: 0.4 }]), { found: 3, total: 4, pct: 75 });
    assert.deepEqual(trackStats([]), { found: 0, total: 0, pct: 0 });
  });
});

describe("cxAt", () => {
  const keys = [{ t: 0, cx: 0.2 }, { t: 10, cx: 0.6 }];
  it("interpolates between keyframes and holds at the ends", () => {
    assert.equal(cxAt(keys, 5), 0.4);
    assert.equal(cxAt(keys, -3), 0.2);
    assert.equal(cxAt(keys, 99), 0.6);
    assert.equal(cxAt([], 1), 0.5);
  });
});

describe("panScript", () => {
  it("writes one command each time the window moves, at output time, with positions in pixels", () => {
    const keys = [{ t: 0, cx: 0.3 }, { t: 2, cx: 0.7 }];
    const s = panScript({ keys, srcW: 1920, cropW: 608, outSec: 2, toSource: (t) => t, hz: 30 });
    const lines = s.trim().split("\n");
    assert.match(lines[0], /^0\.000 crop@pan x \d+;$/);
    const xs = lines.map((l) => Number(/ x (\d+);/.exec(l)![1]));
    assert.ok(xs.every((x, i) => i === 0 || x !== xs[i - 1]), "a command only where it changes");
    assert.ok(xs[0] < xs[xs.length - 1], "pans right");
    assert.ok(xs.every((x) => x >= 0 && x <= 1920 - 608 && x % 2 === 0));
  });

  it("follows a cut video by mapping the result's time to the source's time", () => {
    // pieces 0-1 s and 10-11 s of the source, joined; the subject is on the left early and on the right late
    const keys = [{ t: 0, cx: 0.2 }, { t: 5, cx: 0.2 }, { t: 5.01, cx: 0.8 }, { t: 12, cx: 0.8 }];
    const toSource = (t: number) => (t < 1 ? t : 10 + (t - 1));
    const s = panScript({ keys, srcW: 1920, cropW: 608, outSec: 2, toSource, hz: 10 });
    const first = Number(/ x (\d+);/.exec(s.split("\n")[0])![1]);
    const lastLine = s.trim().split("\n").pop()!;
    const last = Number(/ x (\d+);/.exec(lastLine)![1]);
    assert.ok(first < 600 && last > 900, `first ${first}, last ${last}`);
  });

  it("is one command for a camera that never moves", () => {
    const s = panScript({ keys: [{ t: 0, cx: 0.5 }, { t: 9, cx: 0.5 }], srcW: 1920, cropW: 608, outSec: 5, toSource: (t) => t });
    assert.equal(s.trim().split("\n").length, 1);
  });
});
