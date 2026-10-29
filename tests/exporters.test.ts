import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planCues, safeFileName, srtTime, timecode, toCutList, toEdl, toSrt } from "../src/lib/editor/exporters";

describe("srtTime", () => {
  it("writes HH:MM:SS,mmm", () => {
    assert.equal(srtTime(0), "00:00:00,000");
    assert.equal(srtTime(83.4), "00:01:23,400");
    assert.equal(srtTime(3725.0049), "01:02:05,005");
    assert.equal(srtTime(-2), "00:00:00,000");
  });

  it("rolls milliseconds over instead of writing 1000", () => {
    assert.equal(srtTime(1.9996), "00:00:02,000");
  });
});

describe("toSrt", () => {
  it("numbers the cues from 1 in time order with a blank line between them", () => {
    const srt = toSrt([
      { start: 5, end: 7, text: "둘째" },
      { start: 0, end: 2.5, text: "첫째" },
    ]);
    assert.equal(srt, "1\n00:00:00,000 --> 00:00:02,500\n첫째\n\n2\n00:00:05,000 --> 00:00:07,000\n둘째\n");
  });

  it("drops empty cues and cues that last no time, and numbers what is left", () => {
    const srt = toSrt([
      { start: 0, end: 1, text: "   " },
      { start: 2, end: 2, text: "순간" },
      { start: 3, end: 1, text: "거꾸로" },
      { start: Number.NaN, end: 4, text: "NaN" },
      { start: 4, end: 6, text: "남는 자막" },
    ]);
    assert.equal(srt, "1\n00:00:04,000 --> 00:00:06,000\n남는 자막\n");
  });

  it("keeps a line break inside a cue but never a blank line, which would end the cue early", () => {
    const srt = toSrt([{ start: 0, end: 2, text: "윗줄\n\n\n아랫줄\r\n끝" }]);
    assert.equal(srt, "1\n00:00:00,000 --> 00:00:02,000\n윗줄\n아랫줄\n끝\n");
  });

  it("is empty for no cues", () => {
    assert.equal(toSrt([]), "");
  });
});

describe("timecode and toEdl", () => {
  it("writes HH:MM:SS:FF at the given frame rate", () => {
    assert.equal(timecode(0, 30), "00:00:00:00");
    assert.equal(timecode(1.5, 30), "00:00:01:15");
    assert.equal(timecode(1.5, 24), "00:00:01:12");
    assert.equal(timecode(3725, 25), "01:02:05:00");
  });

  it("places the cuts back to back on the timeline and names the clip", () => {
    const edl = toEdl({ title: "내 쇼츠", fps: 30, clipName: "원본.mp4", cuts: [{ start: 10, end: 20 }, { start: 100, end: 105.5 }] });
    assert.equal(
      edl,
      [
        "TITLE: 내 쇼츠",
        "FCM: NON-DROP FRAME",
        "",
        "001  AX       V     C        00:00:10:00 00:00:20:00 00:00:00:00 00:00:10:00",
        "001  AX       AA    C        00:00:10:00 00:00:20:00 00:00:00:00 00:00:10:00",
        "* FROM CLIP NAME: 원본.mp4",
        "",
        "002  AX       V     C        00:01:40:00 00:01:45:15 00:00:10:00 00:00:15:15",
        "002  AX       AA    C        00:01:40:00 00:01:45:15 00:00:10:00 00:00:15:15",
        "* FROM CLIP NAME: 원본.mp4",
        "",
      ].join("\n"),
    );
  });

  it("skips empty cuts without breaking the event numbers' order, and refuses a non-integer frame rate", () => {
    const edl = toEdl({ title: "t", fps: 25, clipName: "a.mp4", cuts: [{ start: 5, end: 5 }, { start: 1, end: 2 }] });
    assert.ok(!edl.includes("001"), "the empty cut is not an event");
    assert.match(edl, /002 {2}AX {7}V {5}C {8}00:00:01:00 00:00:02:00 00:00:00:00 00:00:01:00/);
    assert.throws(() => toEdl({ title: "t", fps: 29.97, clipName: "a", cuts: [] }), /정수/);
    assert.throws(() => toEdl({ title: "t", fps: 0, clipName: "a", cuts: [] }), /정수/);
  });

  it("keeps a title or clip name with line breaks on one line", () => {
    const edl = toEdl({ title: "두\n줄", fps: 30, clipName: "a\r\nb.mp4", cuts: [{ start: 0, end: 1 }] });
    assert.ok(edl.startsWith("TITLE: 두 줄\n"));
    assert.ok(edl.includes("* FROM CLIP NAME: a b.mp4"));
  });
});

describe("toCutList", () => {
  it("lists where each piece comes from and where it lands", () => {
    const txt = toCutList({ clipName: "원본.mp4", cuts: [{ start: 83, end: 98 }, { start: 3700, end: 3730 }] });
    assert.match(txt, /^원본: 원본\.mp4\n조각 2개 · 결과 길이 0:45\n/);
    assert.match(txt, /1\) 원본 1:23 ~ 1:38 \(15초\) → 결과 0:00 ~ 0:15/);
    assert.match(txt, /2\) 원본 1:01:40 ~ 1:02:10 \(30초\) → 결과 0:15 ~ 0:45/);
  });
});

describe("planCues", () => {
  it("turns the hook, captions and ending card into cues, with captions stopping where the ending starts", () => {
    const cues = planCues({
      hook: { text: "훅", seconds: 2.5 },
      captions: [{ start: 3, end: 6, text: "자막" }, { start: 8, end: 12, text: "끝과 겹침" }],
      ending: { text: "구독", seconds: 3 },
      outputSec: 10,
    });
    assert.deepEqual(cues, [
      { start: 0, end: 2.5, text: "훅", kind: "hook" },
      { start: 3, end: 6, text: "자막", kind: "caption" },
      { start: 8, end: 7, text: "끝과 겹침", kind: "caption" },
      { start: 7, end: 10, text: "구독", kind: "ending" },
    ]);
    // the caption cut to before its start never reaches the file
    assert.equal(toSrt(cues).split("\n\n").length, 3);
  });

  it("limits the hook to the video's length and leaves out blank pieces", () => {
    assert.deepEqual(planCues({ hook: { text: "훅", seconds: 9 }, captions: [], ending: { text: "  ", seconds: 2 }, outputSec: 4 }), [
      { start: 0, end: 4, text: "훅", kind: "hook" },
    ]);
    assert.deepEqual(planCues({ hook: null, captions: [], ending: null, outputSec: 4 }), []);
  });
});

describe("what goes into the subtitle file", () => {
  it("is just the dialogue captions unless the hook and ending are asked for", () => {
    const cues = planCues({
      hook: { text: "훅", seconds: 2 },
      captions: [{ start: 3, end: 5, text: "대사" }],
      ending: { text: "구독", seconds: 2 },
      outputSec: 10,
    });
    const captionsOnly = toSrt(cues.filter((c) => (c.kind ?? "caption") === "caption"));
    assert.equal(captionsOnly, "1\n00:00:03,000 --> 00:00:05,000\n대사\n");
    assert.equal(toSrt(cues).split("\n\n").length, 3, "with everything: the hook, the caption and the ending");
  });
});

describe("safeFileName", () => {
  it("removes characters Windows rejects and keeps Korean", () => {
    assert.equal(safeFileName('내 영상: "쇼츠"/1?', "srt"), "내 영상 쇼츠 1.srt");
    assert.equal(safeFileName("   ", "edl"), "export.edl");
    assert.equal(safeFileName("가".repeat(100), "txt").length, 60 + 4);
  });
});
