import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeFaces } from "../src/lib/editor/faceDetector";
import { attachFaces, chooseFocus, type Box } from "../src/lib/editor/reframe";
import { subjectDetector } from "../src/lib/editor/subjectDetector";

const person = (x0: number, x1: number, extra: Partial<Box> = {}): Box => ({ x0, y0: 0.2, x1, y1: 1, score: 0.9, label: "person", ...extra });
const face = (x0: number, x1: number, score = 0.9) => ({ x0, y0: 0.4, x1, y1: 0.6, score });

describe("faces and the body box", () => {
  it("gives a person box the face inside it, and leaves other things alone", () => {
    const dog: Box = { x0: 0.6, y0: 0.5, x1: 0.9, y1: 0.9, score: 0.8, label: "dog" };
    const out = attachFaces([person(0.1, 0.9), dog], [face(0.55, 0.7)]);
    assert.deepEqual(out[0].face, face(0.55, 0.7));
    assert.equal(out[1].face, undefined, "a dog does not get a face");
  });

  it("gives each face to the smallest person box around it, one face per box", () => {
    const big = person(0, 1);
    const small = person(0.4, 0.8);
    const out = attachFaces([big, small], [face(0.5, 0.6)]);
    assert.ok(out[1].face && !out[0].face);
  });

  it("makes a person of a face that has no body box, so someone stepping in can still be followed", () => {
    const out = attachFaces([], [face(0.02, 0.12)]);
    assert.equal(out.length, 1);
    assert.equal(out[0].label, "person");
    assert.ok(out[0].x0 >= 0 && out[0].x1 <= 1 && out[0].y1 <= 1);
    assert.ok(out[0].face);
  });

  it("follows the face, not the middle of a body box that includes the shoulders", () => {
    // a close-up: the body box spans most of the picture and its middle is 0.45, the face is at 0.56
    const [b] = attachFaces([person(0.0, 0.9)], [face(0.5, 0.62)]);
    const f = chooseFocus([b], null, 0.32)!;
    assert.ok(Math.abs(f.cx - 0.56) < 1e-9, `cx ${f.cx}`);
    const without = chooseFocus([person(0.0, 0.9)], null, 0.32)!;
    assert.ok(Math.abs(without.cx - 0.45) < 1e-9, "no face: unchanged behaviour");
    assert.ok(Math.abs(f.cy - 0.5) < 1e-9, "looks at the face, not a guess from the box top");
  });

  it("the detector adds faces to what it found, and carries on without them when none can be found", async () => {
    // the real model is not loaded here: a fake finder stands in for it, and the object detector is swapped out through the global
    const g = globalThis as unknown as { __detector?: Promise<unknown> };
    g.__detector = Promise.resolve(async () => [{ score: 0.9, label: "person", box: { xmin: 0, ymin: 100, xmax: 640, ymax: 360 } }]);
    try {
      const withFace = await subjectDetector({ width: 640, height: 360 }, undefined, async () => [face(0.5, 0.62)])("x.jpg");
      assert.equal(withFace.length, 1);
      assert.ok(withFace[0].face);
      const none = await subjectDetector({ width: 640, height: 360 }, undefined, async () => [])("x.jpg");
      assert.equal(none[0].face, undefined);
    } finally {
      g.__detector = undefined;
    }
  });
});

describe("reading the YuNet outputs", () => {
  const SIZE = 640;
  const empty = () => {
    const out: Record<string, { data: Float32Array }> = {};
    for (const s of [8, 16, 32]) {
      const n = (SIZE / s) ** 2;
      out[`cls_${s}`] = { data: new Float32Array(n) };
      out[`obj_${s}`] = { data: new Float32Array(n) };
      out[`bbox_${s}`] = { data: new Float32Array(n * 4) };
    }
    return out;
  };

  it("turns a confident cell into a box in fractions of the original picture", () => {
    const out = empty();
    // stride 16: cell (row 20, col 20) of 40 columns, centre offset 0.5 cells, 100 px wide and 120 px tall in the 640 square
    const i = 20 * 40 + 20;
    out.cls_16.data[i] = 0.9;
    out.obj_16.data[i] = 0.9;
    out.bbox_16.data.set([0.5, 0.5, Math.log(100 / 16), Math.log(120 / 16)], i * 4);
    // the original is 1280 x 720: scaled by 0.5 to fit width, so 640 x 360 sits at the top of the square
    const [f] = decodeFaces(out, 0.5, { width: 1280, height: 720 });
    assert.ok(Math.abs((f.x0 + f.x1) / 2 - (20.5 * 16) / 0.5 / 1280) < 1e-6);
    assert.ok(Math.abs(f.x1 - f.x0 - 100 / 0.5 / 1280) < 1e-6);
    assert.ok(Math.abs(f.score - 0.9) < 1e-6);
  });

  it("merges the cells that describe one face and ignores weak ones", () => {
    const out = empty();
    for (const [row, col, c] of [[20, 20, 0.9], [20, 21, 0.85], [5, 5, 0.3]] as const) {
      const i = row * 40 + col;
      out.cls_16.data[i] = c;
      out.obj_16.data[i] = c;
      out.bbox_16.data.set([0.5, 0.5, Math.log(100 / 16), Math.log(100 / 16)], i * 4);
    }
    assert.equal(decodeFaces(out, 1, { width: 640, height: 640 }).length, 1);
  });
});
