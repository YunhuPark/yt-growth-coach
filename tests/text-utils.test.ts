import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanReason } from "../src/lib/discover";
import { wrap } from "../src/lib/render";
import { classifySource } from "../src/lib/sources";
import { parseVideoId } from "../src/lib/util";
import { extractHashtags, findTimestamps, parseDuration } from "../src/lib/youtube";

describe("parseDuration", () => {
  it("reads ISO 8601 durations", () => {
    assert.equal(parseDuration("PT45S"), 45);
    assert.equal(parseDuration("PT1M5S"), 65);
    assert.equal(parseDuration("PT1H2M3S"), 3723);
    assert.equal(parseDuration("P1DT2H"), 86400 + 7200);
    assert.equal(parseDuration("PT0S"), 0);
  });
  it("returns 0 for anything unparseable", () => {
    assert.equal(parseDuration("garbage"), 0);
    assert.equal(parseDuration(""), 0);
  });
});

describe("findTimestamps", () => {
  it("finds h:mm:ss and m:ss and converts to seconds", () => {
    assert.deepEqual(findTimestamps("1:02:03 그리고 12:34"), [3723, 754]);
    assert.deepEqual(findTimestamps("0:45 인트로"), [45]);
    assert.deepEqual(findTimestamps("00:12 합법적으로"), [12]);
  });
  it("ignores things that only look like times", () => {
    assert.deepEqual(findTimestamps("3:75 는 시간이 아님"), []); // seconds can't exceed 59
    assert.deepEqual(findTimestamps("100:30"), []); // not part of a larger number
    assert.deepEqual(findTimestamps("9:5 점"), []);
    assert.deepEqual(findTimestamps("시간 없음"), []);
  });
});

describe("extractHashtags", () => {
  it("collects unique lowercase hashtags from several texts", () => {
    assert.deepEqual(extractHashtags("#프로미스나인 #FROMIS_9", "설명 #프로미스나인 #송하영"), ["프로미스나인", "fromis_9", "송하영"]);
  });
  it("copes with missing text and a lone #", () => {
    assert.deepEqual(extractHashtags(undefined, "# 뒤에 공백", ""), []);
  });
});

describe("parseVideoId", () => {
  const id = "dQw4w9WgXcQ";
  it("accepts the common URL shapes and bare ids", () => {
    assert.equal(parseVideoId(`https://www.youtube.com/watch?v=${id}&t=30s`), id);
    assert.equal(parseVideoId(`https://youtu.be/${id}?t=463`), id);
    assert.equal(parseVideoId(`https://www.youtube.com/shorts/${id}`), id);
    assert.equal(parseVideoId(`https://www.youtube.com/embed/${id}`), id);
    assert.equal(parseVideoId(`  ${id}  `), id);
  });
  it("rejects input that is not a video", () => {
    assert.equal(parseVideoId("hello"), null);
    assert.equal(parseVideoId("https://example.com/page"), null);
    assert.equal(parseVideoId(""), null);
  });
});

describe("wrap (overlay text)", () => {
  it("leaves short text on one line and strips emoji the font can't draw", () => {
    assert.equal(wrap("역공이 시작되는 순간", 13), "역공이 시작되는 순간");
    assert.equal(wrap("📌 다음 편 투표 🎉", 13), "다음 편 투표");
  });
  it("splits two-line text evenly so no word is left alone", () => {
    assert.equal(wrap("결정적 한마디에 분위기 반전", 13), "결정적 한마디에\n분위기 반전");
    assert.equal(wrap("서열 1위라더니... 오늘은 완전히 밀렸다", 12), "서열 1위라더니...\n오늘은 완전히 밀렸다");
  });
  it("breaks a single over-long word and caps the result at 4 lines", () => {
    assert.equal(wrap("가".repeat(20), 12), `${"가".repeat(12)}\n${"가".repeat(8)}`);
    const many = Array.from({ length: 30 }, (_, i) => `단어${i}`).join(" ");
    assert.ok(wrap(many, 8).split("\n").length <= 4);
  });
  it("returns an empty string for empty input", () => {
    assert.equal(wrap("", 12), "");
    assert.equal(wrap("   ", 12), "");
  });
});

describe("classifySource", () => {
  it("marks other fans' compilations", () => {
    assert.equal(classifySource("송하영 모음집 [프로미스나인]", "어떤 팬 채널"), "fan_edit");
    assert.equal(classifySource("웃긴 장면 모음.zip", "팬"), "fan_edit");
  });
  it("marks broadcasters and official channels, even when the title looks like a compilation", () => {
    assert.equal(classifySource("(ENG) [나 아이돌로 산다] 18분", "MBCkpop"), "official");
    assert.equal(classifySource("무대 영상", "KBS Kpop"), "official");
    assert.equal(classifySource("하이라이트 모음", "Some Official Channel"), "official");
  });
  it("treats a studio-style channel that names the subject as official, using the idea's own terms", () => {
    const terms = ["프로미스나인", "fromis_9"];
    assert.equal(classifySource("걱정하지 마세요", "스프 : 스튜디오 프로미스나인", terms), "official");
    // Without the subject's terms there is nothing to tie the studio to this idea (no niche is hardcoded).
    assert.equal(classifySource("걱정하지 마세요", "스프 : 스튜디오 프로미스나인"), "unknown");
    // Naming the subject alone is not enough: fan channels do that too.
    assert.equal(classifySource("장면 정리", "프로미스나인 팬 채널", terms), "unknown");
  });
  it("leaves everything else unclassified", () => {
    assert.equal(classifySource("프로미스나인 유명한 싸움 정리", "나꼰대지 모얌"), "unknown");
  });
  it("does not mistake an ordinary word for a broadcaster", () => {
    assert.equal(classifySource("여행 브이로그", "Athena Travel"), "unknown");
  });
});

describe("cleanReason", () => {
  it("turns leaked metric names into readable text", () => {
    assert.equal(cleanReason("대부분 프로미스나인을 직접 다룹니다(titleMatchPct 83)."), "대부분 프로미스나인을 직접 다룹니다(제목 일치 83%).");
    assert.equal(cleanReason("제목에 핵심어 없음 (hashtagOnlyPct: 60)"), "제목에 핵심어 없음 (해시태그에만 60%)");
  });
  it("leaves normal sentences alone", () => {
    assert.equal(cleanReason("모든 제목이 프로미스나인을 다룹니다."), "모든 제목이 프로미스나인을 다룹니다.");
  });
});
