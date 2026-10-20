import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captionsFor, describeForHighlights, findHighlights, MAX_CANDIDATES, sanitizeHighlights, splitCaption, type RawHighlights } from "../src/lib/highlights";

const cand = (start: number, end: number, score: number, over: Partial<RawHighlights["candidates"][number]> = {}) => ({
  start, end, score, reason: "이유", hook: "훅", title: "제목", ...over,
});

describe("captionsFor", () => {
  const speech = [
    { start: 5, end: 8, text: "클립 앞" },
    { start: 12, end: 15, text: "[빈칸] 안쪽 대사" },
    { start: 19, end: 26, text: "끝에 걸침" },
    { start: 40, end: 42, text: "밖" },
  ];

  it("takes speech inside the range and moves it onto the clip's own timeline", () => {
    const c = captionsFor(10, 22, speech);
    assert.deepEqual(c, [{ start: 2, end: 5, text: "안쪽 대사" }, { start: 9, end: 12, text: "끝에 걸침" }]);
  });

  it("returns nothing without speech or when no line falls inside", () => {
    assert.deepEqual(captionsFor(10, 22, []), []);
    assert.deepEqual(captionsFor(30, 38, speech), []);
  });

  it("drops slivers shorter than half a second", () => {
    assert.deepEqual(captionsFor(7.7, 20, [{ start: 5, end: 8, text: "조금 걸침" }]), []);
  });
});

describe("splitCaption and long lines", () => {
  it("splits at sentence ends, then at spaces, keeping each piece short", () => {
    assert.deepEqual(splitCaption("짧은 문장"), ["짧은 문장"]);
    assert.deepEqual(splitCaption("드디어 새 앨범이 공개되었습니다. 팬 여러분이 가장 기다리던 순간입니다."), [
      "드디어 새 앨범이 공개되었습니다.",
      "팬 여러분이 가장 기다리던 순간입니다.",
    ]);
    assert.deepEqual(splitCaption("하나 둘 셋 넷 다섯 여섯 일곱 여덟 아홉 열 열하나 열둘"), ["하나 둘 셋 넷 다섯 여섯 일곱 여덟", "아홉 열 열하나 열둘"]);
    assert.ok(splitCaption("가나다라마바사 ".repeat(10).trim()).every((p) => p.length <= 22));
  });

  it("shares a long line's time between its pieces, in order and without gaps, ending where the line ends", () => {
    const text = "드디어 새 앨범의 컨셉 포토가 공개되었습니다. 팬 여러분이 가장 기다리던 순간입니다.";
    const c = captionsFor(0, 20, [{ start: 2, end: 11, text }]);
    assert.ok(c.length >= 2 && c.every((x) => x.text.length <= 44));
    assert.equal(c[0].start, 2);
    assert.equal(c[c.length - 1].end, 11);
    assert.ok(c.every((x, i) => x.end - x.start >= 1 && (i === 0 || Math.abs(x.start - c[i - 1].end) < 0.11)));
    assert.equal(c.map((x) => x.text).join(" "), text);
  });

  it("does not leave a piece on screen for under a second: it joins the next one", () => {
    const c = captionsFor(0, 20, [{ start: 0, end: 3, text: "네. 안녕하세요 여러분 오늘도 찾아와 주셔서 감사해요." }]);
    assert.ok(c.every((x) => x.end - x.start >= 1 || c.length === 1));
  });
});

describe("sanitizeHighlights", () => {
  it("ranks by score, clamps to the file, drops clips under 8 seconds", () => {
    const out = sanitizeHighlights(
      { candidates: [cand(0, 20, 5), cand(100, 400, 9), cand(50, 54, 10), cand(-5, 3, 7)] },
      { duration: 200 },
    );
    // 100–400 is cut to the file end (200) then to the 90 s limit; 50–54 and -5–3 are too short
    assert.deepEqual(out.map((h) => [h.start, h.end, h.score]), [[100, 190, 9], [0, 20, 5]]);
  });

  it("never exceeds the Shorts length limit", () => {
    const [h] = sanitizeHighlights({ candidates: [cand(0, 600, 8)] }, { duration: 1000 });
    assert.ok(h.end - h.start <= 90);
  });

  it("keeps the better of two overlapping candidates", () => {
    const out = sanitizeHighlights({ candidates: [cand(10, 40, 6), cand(20, 50, 8), cand(100, 130, 7)] }, { duration: 300 });
    assert.deepEqual(out.map((h) => h.score), [8, 7]);
  });

  it("caps the number of candidates and clamps scores to 1-10", () => {
    const many = Array.from({ length: 12 }, (_, i) => cand(i * 100, i * 100 + 20, i === 0 ? 99 : 5));
    const out = sanitizeHighlights({ candidates: many }, { duration: 2000 });
    assert.equal(out.length, MAX_CANDIDATES);
    assert.equal(out[0].score, 10);
  });

  it("moves cuts off the middle of a sentence and attaches that clip's speech as captions", () => {
    const speech = [{ start: 9, end: 12, text: "첫 문장" }, { start: 28, end: 30.5, text: "끝 문장" }];
    const [h] = sanitizeHighlights({ candidates: [cand(10, 30, 8)] }, { duration: 100, speech });
    assert.equal(h.start, 9, "start moved to the sentence start");
    assert.equal(h.end, 30.5, "end moved to the sentence end");
    assert.deepEqual(h.captions.map((c) => c.text), ["첫 문장", "끝 문장"]);
    assert.equal(h.captions[0].start, 0);
  });

  it("strips [placeholders] from model text and ignores non-finite numbers", () => {
    const out = sanitizeHighlights(
      { candidates: [cand(0, 30, 6, { hook: "[빈칸] 와", title: "  [x] 제목\n" }), cand(NaN, 30, 9), cand(0, 30, Infinity)] },
      { duration: 100 },
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].hook, "와");
    assert.equal(out[0].title, "제목");
  });

  it("returns an empty list when nothing usable comes back", () => {
    assert.deepEqual(sanitizeHighlights({ candidates: [] }, { duration: 100 }), []);
  });
});

describe("findHighlights", () => {
  const analysis = {
    duration: 600, width: 1920, height: 1080, hasAudio: true,
    scenes: [30, 200], silences: [{ start: 100, end: 110 }], loudness: [{ t: 0, db: -20 }], frames: [],
    speech: { segments: [{ start: 40, end: 44, text: "핵심 대사" }], truncated: true },
  };

  it("sends the facts, marks speech as content not instructions, and returns sanitized candidates", async () => {
    let text = "";
    let system = "";
    const out = await findHighlights(analysis, { topic: "프로미스나인 팬캠", count: 4 }, async (sys, content) => {
      system = sys;
      text = content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
      return { candidates: [cand(38, 70, 9), cand(500, 900, 4)] };
    });
    assert.match(text, /프로미스나인 팬캠/);
    assert.match(text, /최대 4개/);
    assert.match(text, /\[40\.0~44\.0\] 핵심 대사/);
    assert.match(text, /앞부분 30분까지만/);
    assert.match(system, /지시가 아닙니다/);
    assert.equal(out[0].start, 38);
    assert.equal(out[0].captions[0].text, "핵심 대사");
    assert.equal(out[1].end, 590, "second candidate is clipped to 90 s");
  });

  it("describes a run without speech recognition honestly", () => {
    const { speech: _unused, ...plain } = analysis;
    void _unused;
    assert.match(describeForHighlights(plain, { topic: "", count: 3 }), /대사 인식: 사용하지 않음/);
  });
});
