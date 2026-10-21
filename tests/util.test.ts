import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeForHighlights } from "../src/lib/highlights";
import { describeSignals, type UrlSignals } from "../src/lib/urlPlan";
import { safeSlice, wellFormed } from "../src/lib/util";

const hasLoneSurrogate = (s: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

describe("safeSlice", () => {
  it("behaves like slice for ordinary text", () => {
    assert.equal(safeSlice("안녕하세요", 3), "안녕하");
    assert.equal(safeSlice("abc", 10), "abc");
  });

  it("never leaves the first half of an emoji at the end", () => {
    const s = "ab😀cd"; // the emoji is two UTF-16 units at index 2-3
    assert.equal(safeSlice(s, 3), "ab");
    assert.equal(safeSlice(s, 4), "ab😀");
    assert.ok(!hasLoneSurrogate(safeSlice("가".repeat(5) + "😀", 6)));
  });
});

describe("wellFormed", () => {
  it("replaces lone surrogates and leaves proper emoji and text alone", () => {
    assert.equal(wellFormed("ok 😀 한글"), "ok 😀 한글");
    assert.equal(wellFormed("a\uD83Db"), "a�b");
    assert.equal(wellFormed("a\uDE00b"), "a�b");
    assert.ok(!hasLoneSurrogate(wellFormed("x\uD83D")));
  });

  it("makes the request text safe to turn into JSON that a strict parser accepts", () => {
    const broken = "댓글 \uD83D 끝";
    assert.ok(JSON.stringify(broken).includes("\\ud83d"), "a lone surrogate is written out as an escape the API rejects");
    assert.ok(!JSON.stringify(wellFormed(broken)).includes("\\ud83d"));
  });
});

describe("text sent to the model", () => {
  const broken = "이 장면 대박 \uD83D";

  it("holds no lone surrogate even when a comment or the description does", () => {
    const s: UrlSignals = {
      video: { id: "abc", title: "제목\uD83D", channelTitle: "채널", durationSec: 600, views: 1, publishedAt: "", url: "https://youtu.be/abc" },
      description: "설명 " + broken,
      moments: [{ sec: 83, weight: 5, likes: 4, comments: 1, samples: [broken] }],
      chapters: [],
      topComments: [{ text: broken, likes: 3 }],
      commentsOk: true,
    };
    assert.ok(!hasLoneSurrogate(describeSignals(s, { topic: broken, count: 3 })));
  });

  it("is the same for the file analysis with viewer moments", () => {
    const a = { duration: 600, width: 1920, height: 1080, hasAudio: false, scenes: [], silences: [], loudness: [], frames: [] };
    const text = describeForHighlights(a, { topic: broken, count: 3, moments: [{ sec: 83, likes: 4, comments: 1, samples: [broken] }] });
    assert.ok(!hasLoneSurrogate(text));
  });
});
