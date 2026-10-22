import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignTracks,
  chooseFocus,
  cropFraction,
  cropHeightFraction,
  cropSizePx,
  cropWidthPx,
  cyAt,
  dedupeBoxes,
  inTarget,
  panScript,
  samplesFromLooks,
  smoothTrack,
  suggestZoom,
  type Box,
  type Look,
  type Sample,
} from "../src/lib/reframe";

const box = (x0: number, x1: number, score = 0.9, y0 = 0.2, y1 = 0.9): Box => ({ x0, x1, y0, y1, score });
const labeled = (label: string, x0: number, x1: number, y0 = 0.2, y1 = 0.9, score = 0.9): Box => ({ x0, x1, y0, y1, score, label });

describe("what to follow", () => {
  it("knows people, animals and vehicles apart, and treats an unlabelled box as a person", () => {
    assert.ok(inTarget(box(0, 0.1), "person"));
    assert.ok(inTarget(labeled("dog", 0, 0.1), "animal") && !inTarget(labeled("dog", 0, 0.1), "person"));
    assert.ok(inTarget(labeled("car", 0, 0.1), "vehicle") && !inTarget(labeled("car", 0, 0.1), "animal"));
    assert.ok(["person", "dog", "car"].every((l) => inTarget(labeled(l, 0, 0.1), "all")));
    assert.ok(!inTarget(labeled("chair", 0, 0.1), "all"));
  });

  it("does not merge a person with the animal they ride", () => {
    assert.equal(dedupeBoxes([labeled("person", 0.4, 0.6), labeled("horse", 0.4, 0.6, 0.2, 0.9, 0.8)]).length, 2);
  });
});

describe("zoom geometry", () => {
  it("makes the window smaller both ways, still 9:16, even and inside the picture", () => {
    assert.equal(cropFraction(1920, 1080, 2), cropFraction(1920, 1080) / 2);
    assert.equal(cropHeightFraction(2), 0.5);
    const { w, h } = cropSizePx(1920, 1080, 2);
    assert.deepEqual([w, h], [304, 540]);
    assert.ok(Math.abs(w / h - 9 / 16) < 0.01);
    assert.deepEqual(cropSizePx(1920, 1080), { w: cropWidthPx(1920, 1080), h: 1080 });
  });
  it("keeps zoom between 1 and 3", () => {
    assert.equal(cropHeightFraction(0.2), 1);
    assert.equal(cropHeightFraction(50), 1 / 3);
  });
});

describe("chooseFocus", () => {
  it("looks at a person's upper body and the middle of anything else", () => {
    const p = chooseFocus([box(0.4, 0.5, 0.9, 0.2, 0.8)], null, 0.316)!;
    assert.ok(Math.abs(p.cy - (0.2 + 0.3 * 0.6)) < 1e-9);
    const d = chooseFocus([labeled("dog", 0.4, 0.5, 0.2, 0.8)], null, 0.316)!;
    assert.ok(Math.abs(d.cy - 0.5) < 1e-9);
  });
});

describe("assignTracks", () => {
  const look = (t: number, ...b: Box[]): Look => ({ t, boxes: b });
  it("keeps one id for a person who moves a little between looks, and a new id for a second person", () => {
    const tracked = assignTracks([look(0, box(0.2, 0.3), box(0.7, 0.8)), look(0.5, box(0.22, 0.32), box(0.68, 0.78)), look(1, box(0.24, 0.34))]);
    const [a, b] = tracked[0].boxes.map((x) => x.id);
    assert.notEqual(a, b);
    assert.deepEqual(tracked[1].boxes.map((x) => x.id), [a, b]);
    assert.deepEqual(tracked[2].boxes.map((x) => x.id), [a]);
  });
  it("keeps the id across a short miss but not a long one", () => {
    const short = assignTracks([look(0, box(0.2, 0.3)), look(0.5), look(1, box(0.21, 0.31))]);
    assert.equal(short[2].boxes[0].id, short[0].boxes[0].id);
    const long = assignTracks([look(0, box(0.2, 0.3)), look(3, box(0.21, 0.31))]);
    assert.notEqual(long[1].boxes[0].id, long[0].boxes[0].id);
  });
  it("does not mix up a person with a dog next to them", () => {
    const t = assignTracks([look(0, box(0.3, 0.4), labeled("dog", 0.32, 0.42, 0.6, 0.9)), look(0.5, box(0.31, 0.41), labeled("dog", 0.33, 0.43, 0.6, 0.9))]);
    assert.equal(t[1].boxes[0].id, t[0].boxes[0].id);
    assert.equal(t[1].boxes[1].id, t[0].boxes[1].id);
    assert.notEqual(t[0].boxes[0].id, t[0].boxes[1].id);
  });
  it("gives a different id to whoever appears after a cut far from where the last one was", () => {
    const t = assignTracks([look(0, box(0.1, 0.2)), look(0.5, box(0.8, 0.9))]);
    assert.notEqual(t[1].boxes[0].id, t[0].boxes[0].id);
  });
});

describe("samplesFromLooks", () => {
  const frac = 0.316;
  const looks = assignTracks([
    { t: 0, boxes: [box(0.1, 0.2), labeled("dog", 0.7, 0.8, 0.5, 0.9)] },
    { t: 0.5, boxes: [box(0.1, 0.2), labeled("dog", 0.7, 0.8, 0.5, 0.9)] },
    { t: 1, boxes: [labeled("dog", 0.7, 0.8, 0.5, 0.9)] },
  ]);
  it("follows the chosen kind of subject", () => {
    const people = samplesFromLooks(looks, { target: "person", cropFrac: frac });
    assert.ok(Math.abs(people[0].cx! - 0.15) < 1e-9);
    assert.equal(people[2].cx, null);
    const dogs = samplesFromLooks(looks, { target: "animal", cropFrac: frac });
    assert.ok(dogs.every((s) => Math.abs(s.cx! - 0.75) < 1e-9));
  });
  it("follows only the picked ones and has no answer when they are not in view", () => {
    const dogId = looks[0].boxes[1].id;
    const s = samplesFromLooks(looks, { target: "all", cropFrac: frac, picks: [dogId] });
    assert.ok(s.every((x) => Math.abs(x.cx! - 0.75) < 1e-9));
    const personId = looks[0].boxes[0].id;
    const p = samplesFromLooks(looks, { target: "all", cropFrac: frac, picks: [personId] });
    assert.ok(Math.abs(p[0].cx! - 0.15) < 1e-9);
    assert.equal(p[2].cx, null);
  });
});

describe("suggestZoom", () => {
  const tall = (h: number): Look[] => Array.from({ length: 5 }, (_, i) => ({ t: i, boxes: [box(0.4, 0.5, 0.9, 0.1, 0.1 + h)] }));
  it("zooms in on a small subject, up to 2", () => {
    assert.equal(suggestZoom(tall(0.3), "person"), 1.8);
    assert.equal(suggestZoom(tall(0.1), "person"), 2);
  });
  it("does not zoom on a subject that is already big, or when nobody is found", () => {
    assert.equal(suggestZoom(tall(0.7), "person"), 1);
    assert.equal(suggestZoom([], "person"), 1);
    assert.equal(suggestZoom(tall(0.3), "animal"), 1);
  });
});

describe("smoothTrack and the vertical script", () => {
  it("moves up and down as well, within the picture", () => {
    const samples: Sample[] = Array.from({ length: 20 }, (_, i) => ({ t: i * 0.5, cx: 0.5, cy: 0.2 }));
    const keys = smoothTrack(samples, { cropFrac: 0.2, cropHFrac: 0.5, duration: 9.5, smooth: 1 });
    assert.ok(keys.every((k) => k.cy !== undefined && k.cy >= 0.25 - 1e-9 && k.cy <= 0.75 + 1e-9));
    assert.ok(Math.abs(keys[keys.length - 1].cy! - 0.25) < 0.02, "settles at the top edge the window can reach");
  });
  it("stays in the middle vertically when the window is as tall as the picture", () => {
    const samples: Sample[] = [{ t: 0, cx: 0.5, cy: 0.1 }, { t: 1, cx: 0.5, cy: 0.1 }];
    assert.ok(smoothTrack(samples, { cropFrac: 0.3, cropHFrac: 1, duration: 1, smooth: 3 }).every((k) => k.cy === 0.5));
  });
  it("interpolates cy, and the script moves y only when asked to and only when it changes", () => {
    const keys = [{ t: 0, cx: 0.5, cy: 0.2 }, { t: 2, cx: 0.5, cy: 0.8 }];
    assert.equal(cyAt(keys, 1), 0.5);
    assert.equal(cyAt([{ t: 0, cx: 0.5 }], 1), 0.5);
    const withY = panScript({ keys, srcW: 1000, cropW: 200, srcH: 1000, cropH: 400, outSec: 2, toSource: (t) => t });
    assert.match(withY, /crop@pan y \d+/);
    assert.ok(!/ x /.test(withY.split("\n").slice(1).join("\n")), "x never changes after the first command");
    const noY = panScript({ keys, srcW: 1000, cropW: 200, outSec: 2, toSource: (t) => t });
    assert.ok(!/ y /.test(noY));
    const full = panScript({ keys, srcW: 1000, cropW: 200, srcH: 1000, cropH: 1000, outSec: 2, toSource: (t) => t });
    assert.ok(!/ y /.test(full), "a window as tall as the picture has no vertical movement");
  });
});
