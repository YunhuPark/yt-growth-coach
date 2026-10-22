import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cutStats, DEFAULT_CUT_OPTIONS, fillerRemovals, keepSegments, planRemovals, silenceRemovals, type Removal } from "../src/lib/cutPlan";

describe("silenceRemovals", () => {
  it("cuts each long-enough silence but leaves half of the pause kept at each end", () => {
    const r = silenceRemovals([{ start: 10, end: 14 }, { start: 20, end: 20.3 }], { minSec: 0.6, keepSec: 0.2 });
    assert.deepEqual(r.map((x) => [x.start, x.end, x.kind]), [[10.1, 13.9, "silence"]]);
  });

  it("keeps nothing of a pause when keepSec is 0, and ignores silences below the minimum", () => {
    assert.deepEqual(silenceRemovals([{ start: 1, end: 3 }], { minSec: 0.5, keepSec: 0 }).map((x) => [x.start, x.end]), [[1, 3]]);
    assert.deepEqual(silenceRemovals([{ start: 1, end: 1.4 }], { minSec: 0.5, keepSec: 0 }), []);
  });

  it("drops a pause so short that nothing would be left to remove, and handles unsorted or backwards input", () => {
    assert.deepEqual(silenceRemovals([{ start: 1, end: 1.7 }], { minSec: 0.5, keepSec: 0.68 }), []);
    const r = silenceRemovals([{ start: 30, end: 33 }, { start: 5, end: 8 }, { start: 9, end: 2 }], { minSec: 0.5, keepSec: 0 });
    assert.deepEqual(r.map((x) => x.start), [5, 30]);
  });
});

describe("fillerRemovals", () => {
  const w = (text: string, start: number, end: number) => ({ text, start, end });

  it("finds hesitation sounds written on their own, whatever punctuation Whisper put on them", () => {
    const r = fillerRemovals([w(" 음.", 0.3, 1.2), w(" 안녕하세요.", 1.5, 2.8), w("어…", 3.1, 3.9), w("으음", 9.5, 10.5), w("흠", 12, 12.6)], { loose: false });
    assert.deepEqual(r.map((x) => x.text), ["음.", "어…", "으음", "흠"]);
    assert.ok(r.every((x) => x.kind === "filler"));
  });

  it("leaves real words alone, including ones that merely contain a hesitation sound", () => {
    const r = fillerRemovals([w("어떻게", 1, 1.6), w("음식", 2, 2.5), w("아니", 3, 3.3), w("그", 4, 4.2), w("에서", 5, 5.3)], { loose: false });
    assert.deepEqual(r, []);
  });

  it("counts 그, 저, 뭐 only when asked for and only when drawn out", () => {
    const words = [w("그", 4.62, 5.72), w("뭐", 5.72, 6.82), w("그", 8, 8.2), w("저", 9, 9.7)];
    assert.deepEqual(fillerRemovals(words, { loose: false }), []);
    assert.deepEqual(fillerRemovals(words, { loose: true }).map((x) => x.text), ["그", "뭐", "저"], "the quick 그 is an ordinary word");
  });

  it("removes just the word's own time, with a hair of margin, and ignores impossible words", () => {
    const [x] = fillerRemovals([w("음", 3, 4)], { loose: false });
    assert.deepEqual([x.start, x.end], [3.02, 3.98]);
    assert.deepEqual(fillerRemovals([w("음", 3, 3), w("음", 5, 9), w("음", 7, 6)], { loose: false }), [], "no length, too long to be a hesitation, backwards");
  });
});

describe("planRemovals", () => {
  const sil = [{ start: 10, end: 13 }];
  const words = [{ text: "음", start: 20, end: 21 }];

  it("gives silence and fillers in time order, with ids by kind", () => {
    const r = planRemovals(sil, words, { silence: { enabled: true, noiseDb: -35, minSec: 0.5, keepSec: 0 }, fillers: { enabled: true, loose: false } });
    assert.deepEqual(r.map((x) => [x.id, x.kind, x.start]), [["s0", "silence", 10], ["f1", "filler", 20.02]]);
  });

  it("lists a soft hesitation once: the filler stays and the silence it was also detected as is dropped", () => {
    const r = planRemovals(
      [{ start: 12.36, end: 13.29 }, { start: 30, end: 33 }],
      [{ text: "음.", start: 12.36, end: 13.2 }],
      { silence: { enabled: true, noiseDb: -35, minSec: 0.5, keepSec: 0 }, fillers: { enabled: true, loose: false } },
    );
    assert.deepEqual(r.map((x) => [x.kind, x.text ?? ""]), [["filler", "음."], ["silence", ""]]);
    // a silence only grazing a filler is not a duplicate
    const edge = planRemovals([{ start: 10, end: 14 }], [{ text: "음", start: 13.8, end: 14.6 }], { silence: { enabled: true, noiseDb: -35, minSec: 0.5, keepSec: 0 }, fillers: { enabled: true, loose: false } });
    assert.equal(edge.length, 2);
  });

  it("leaves out whatever is switched off", () => {
    assert.deepEqual(planRemovals(sil, words, DEFAULT_CUT_OPTIONS).map((x) => x.kind), ["silence"], "fillers are off by default");
    assert.deepEqual(planRemovals(sil, words, { ...DEFAULT_CUT_OPTIONS, silence: { ...DEFAULT_CUT_OPTIONS.silence, enabled: false } }), []);
  });
});

describe("keepSegments", () => {
  const cut = (start: number, end: number): Removal => ({ id: "x", start, end, kind: "silence" });

  it("is the whole video when nothing is cut", () => {
    assert.deepEqual(keepSegments(60, []), [{ start: 0, end: 60 }]);
  });

  it("is what lies between the cuts, including the start and the end", () => {
    assert.deepEqual(keepSegments(60, [cut(10, 15), cut(40, 45)]), [{ start: 0, end: 10 }, { start: 15, end: 40 }, { start: 45, end: 60 }]);
  });

  it("merges overlapping and touching cuts, and clamps cuts that stick out of the video", () => {
    assert.deepEqual(keepSegments(60, [cut(10, 20), cut(18, 25), cut(25, 30), cut(-5, 2), cut(58, 99)]), [{ start: 2, end: 10 }, { start: 30, end: 58 }]);
  });

  it("drops slivers shorter than the minimum, and returns nothing when everything is cut", () => {
    assert.deepEqual(keepSegments(60, [cut(10, 30), cut(30.1, 60)], 0.3), [{ start: 0, end: 10 }]);
    assert.deepEqual(keepSegments(60, [cut(0, 60)]), []);
  });

  it("does not depend on the order the cuts come in", () => {
    assert.deepEqual(keepSegments(60, [cut(40, 45), cut(10, 15)]), keepSegments(60, [cut(10, 15), cut(40, 45)]));
  });
});

describe("cutStats", () => {
  it("adds up what was kept and removed and counts cuts by kind", () => {
    const removals: Removal[] = [
      { id: "s0", start: 10, end: 15, kind: "silence" },
      { id: "f1", start: 20, end: 21, kind: "filler" },
      { id: "s2", start: 40, end: 44, kind: "silence" },
    ];
    const kept = keepSegments(60, removals);
    assert.deepEqual(cutStats(60, kept, removals), { originalSec: 60, keptSec: 50, removedSec: 10, pieces: 4, silences: 2, fillers: 1 });
  });
});
