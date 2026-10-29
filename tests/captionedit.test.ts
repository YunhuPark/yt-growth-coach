import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captionHasBadTimes, editedCaptions, toCaps } from "../src/lib/editor/captionEdit";

describe("editedCaptions", () => {
  it("turns typed text into numbers and trims it", () => {
    assert.deepEqual(editedCaptions([{ start: "0.5", end: "2", text: "  안녕  " }]), [{ start: 0.5, end: 2, text: "안녕" }]);
  });

  it("drops blank text and lines whose times can't be used", () => {
    const out = editedCaptions([
      { start: "0", end: "2", text: "   " },
      { start: "", end: "3", text: "시작 비어 있음" }, // Number("") is 0, so this one is valid: empty means 0
      { start: "5", end: "4", text: "끝이 먼저" },
      { start: "abc", end: "3", text: "숫자 아님" },
      { start: "-1", end: "2", text: "음수" },
      { start: "1", end: "", text: "끝 비어 있음" },
    ]);
    assert.deepEqual(out.map((c) => c.text), ["시작 비어 있음"]);
  });

  it("round-trips the generated captions unchanged", () => {
    const caps = [{ start: 0.3, end: 3.4, text: "드디어" }, { start: 3.4, end: 5, text: "공개" }];
    assert.deepEqual(editedCaptions(toCaps(caps)), caps);
  });
});

describe("captionHasBadTimes", () => {
  it("flags a line with text but unusable times, not an empty row", () => {
    assert.equal(captionHasBadTimes({ start: "5", end: "4", text: "x" }), true);
    assert.equal(captionHasBadTimes({ start: "0", end: "", text: "x" }), true);
    assert.equal(captionHasBadTimes({ start: "5", end: "4", text: "" }), false);
    assert.equal(captionHasBadTimes({ start: "0", end: "2", text: "x" }), false);
  });
});
