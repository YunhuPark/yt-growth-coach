import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizePlan, type RawPlan } from "../src/lib/editor/autoEdit";
import { chapterLines, formatClock, mapChapters, withChapterCards } from "../src/lib/editor/chapters";

describe("formatClock", () => {
  it("writes m:ss, and h:mm:ss from an hour", () => {
    assert.equal(formatClock(0), "0:00");
    assert.equal(formatClock(75.9), "1:15");
    assert.equal(formatClock(3725), "1:02:05");
    assert.equal(formatClock(-3), "0:00");
  });
});

describe("mapChapters", () => {
  const kept = [{ start: 100, end: 200 }, { start: 400, end: 500 }]; // output: 0-100 from the first, 100-200 from the second

  it("maps source time onto the edited timeline", () => {
    const out = mapChapters(
      [{ start: 100, title: "시작" }, { start: 150, title: "중반" }, { start: 420, title: "후반" }],
      kept,
    );
    assert.deepEqual(out, [{ time: 0, title: "시작" }, { time: 50, title: "중반" }, { time: 120, title: "후반" }]);
  });

  it("moves a chapter that fell in a cut part to the start of the next kept part, and drops one after the end", () => {
    const out = mapChapters(
      [{ start: 100, title: "A" }, { start: 300, title: "컷 안" }, { start: 450, title: "C" }, { start: 900, title: "끝 뒤" }],
      kept,
    );
    assert.deepEqual(out.map((c) => [c.time, c.title]), [[0, "A"], [100, "컷 안"], [150, "C"]]);
  });

  it("starts at 0:00: pins a first chapter that begins within 10 s, otherwise adds an opening chapter", () => {
    const near = mapChapters([{ start: 105, title: "소개" }, { start: 140, title: "B" }, { start: 180, title: "C" }], kept);
    assert.deepEqual(near[0], { time: 0, title: "소개" });
    const far = mapChapters([{ start: 130, title: "본론" }, { start: 160, title: "B" }, { start: 190, title: "C" }], kept);
    assert.deepEqual(far[0], { time: 0, title: "오프닝" });
    assert.equal(far[1].title, "본론");
  });

  it("drops chapters closer than 10 s to the one before", () => {
    const out = mapChapters(
      [{ start: 100, title: "A" }, { start: 104, title: "너무 가까움" }, { start: 140, title: "B" }, { start: 180, title: "C" }],
      kept,
    );
    assert.deepEqual(out.map((c) => c.title), ["A", "B", "C"]);
  });

  it("gives nothing when fewer than 3 chapters are usable, because YouTube would ignore the list", () => {
    assert.deepEqual(mapChapters([{ start: 100, title: "A" }, { start: 150, title: "B" }], kept), []);
    assert.deepEqual(mapChapters([], kept), []);
    assert.deepEqual(mapChapters([{ start: 100, title: "A" }], []), []);
  });

  it("cleans titles: placeholders, control characters, blank ones, and length", () => {
    const out = mapChapters(
      [{ start: 100, title: "[빈칸] 오프닝\n" }, { start: 130, title: "   " }, { start: 150, title: "가".repeat(80) }, { start: 180, title: "끝" }, { start: 190, title: "마무리" }],
      kept,
    );
    assert.equal(out[0].title, "오프닝");
    assert.equal(out[1].title.length, 40);
    assert.ok(out.every((c) => c.title.trim() === c.title && c.title));
  });
});

describe("chapterLines and withChapterCards", () => {
  const chapters = [{ time: 0, title: "오프닝" }, { time: 65, title: "본론" }, { time: 3700, title: "마무리" }];

  it("writes the list the way a description needs it", () => {
    assert.equal(chapterLines(chapters), "0:00 오프닝\n1:05 본론\n1:01:40 마무리");
  });

  it("adds a title card for every chapter after the first, each ending before the next chapter starts", () => {
    const cards = withChapterCards([], [{ time: 0, title: "오프닝" }, { time: 10, title: "A" }, { time: 12, title: "B" }, { time: 60, title: "C" }]);
    assert.deepEqual(cards, [{ start: 10, end: 12, text: "A" }, { start: 12, end: 16, text: "B" }, { start: 60, end: 64, text: "C" }]);
  });

  it("drops a caption that would sit under a card and keeps the rest, in time order", () => {
    const out = withChapterCards(
      [{ start: 2, end: 5, text: "앞" }, { start: 64, end: 68, text: "카드와 겹침" }, { start: 80, end: 85, text: "뒤" }],
      chapters.slice(0, 2),
    );
    assert.deepEqual(out.map((c) => c.text), ["앞", "본론", "뒤"]);
  });
});

describe("sanitizePlan with chapters", () => {
  const raw = (over: Partial<RawPlan> = {}): RawPlan => ({
    summary: "s", segments: [{ start: 0, end: 300, reason: "all" }], hook: null, captions: [], ending: null,
    titles: ["t"], description: "설명입니다.", hashtags: [],
    chapters: [{ start: 0, title: "오프닝" }, { start: 100, title: "본론" }, { start: 200, title: "마무리" }],
    ...over,
  });

  it("puts the chapter list at the end of a long-form description", () => {
    const p = sanitizePlan(raw(), { duration: 300, layout: "long" });
    assert.deepEqual(p.chapters.map((c) => c.time), [0, 100, 200]);
    assert.equal(p.description, "설명입니다.\n\n0:00 오프닝\n1:40 본론\n3:20 마무리");
  });

  it("never adds chapters to a Short", () => {
    const p = sanitizePlan(raw(), { duration: 300, layout: "short" });
    assert.deepEqual(p.chapters, []);
    assert.equal(p.description, "설명입니다.");
  });

  it("warns when a long-form plan ends up without usable chapters", () => {
    const p = sanitizePlan(raw({ chapters: [{ start: 0, title: "하나뿐" }] }), { duration: 300, layout: "long" });
    assert.deepEqual(p.chapters, []);
    assert.ok(p.warnings.some((w) => /챕터/.test(w)));
    assert.equal(p.description, "설명입니다.");
  });

  it("maps chapters through the cuts", () => {
    const p = sanitizePlan(
      raw({ segments: [{ start: 50, end: 150, reason: "a" }, { start: 250, end: 300, reason: "b" }], chapters: [{ start: 50, title: "A" }, { start: 100, title: "B" }, { start: 260, title: "C" }] }),
      { duration: 300, layout: "long" },
    );
    assert.deepEqual(p.chapters, [{ time: 0, title: "A" }, { time: 50, title: "B" }, { time: 110, title: "C" }]);
  });
});
