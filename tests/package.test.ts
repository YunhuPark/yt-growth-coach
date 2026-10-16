import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLongPack, LongPack, Pack } from "../src/lib/package";

const longSample = {
  target_length_min: 10,
  titles: [{ text: "서열 1위의 하루 [상황]", style: "궁금증형" }],
  thumbnails: [{ overlay_text: "1위의 굴욕", visual: "당황한 표정 클로즈업" }],
  hook_caption: "오늘은 [상황]",
  opening_script: "오늘 보여드릴 건…",
  chapters: [
    { time: "0:00", title: "오프닝", purpose: "약속" },
    { time: "1:30", title: "본론", purpose: "전개" },
  ],
  retention_tactics: [{ at: "3:00", tactic: "다음 장면 예고" }],
  midroll_cta: "3분쯤에 구독 한마디",
  ending_cta: "다음 영상도 이어서",
  pinned_comment: "어떤 장면이 제일 웃겼나요?",
  description: "설명",
  hashtags: ["#프로미스나인"],
  upload_slot: "일요일 저녁",
  fill_in: ["[상황]을 채우기"],
};

const shortSample = {
  titles: [{ text: "[프로미스나인] 장면", style: "서사형" }],
  hook_caption: "훅",
  shot_plan: [{ time: "0–2초", pick: "표정", caption: "", edit_tip: "클로즈업" }],
  ending_cta: "구독",
  pinned_comment: "투표",
  description: "설명",
  hashtags: ["#프로미스나인"],
  upload_slot: "일요일",
  fill_in: [],
};

describe("package schemas", () => {
  it("accepts a complete long-form package and rejects one without chapters", () => {
    assert.ok(LongPack.safeParse(longSample).success);
    const rest: Record<string, unknown> = { ...longSample };
    delete rest.chapters;
    assert.equal(LongPack.safeParse(rest).success, false);
  });

  it("keeps the short and long schemas distinct", () => {
    assert.ok(Pack.safeParse(shortSample).success);
    assert.equal(Pack.safeParse(longSample).success, false);
    assert.equal(LongPack.safeParse(shortSample).success, false);
  });
});

describe("isLongPack", () => {
  it("tells the two kinds apart, including packages saved before long-form existed", () => {
    assert.equal(isLongPack(longSample), true);
    assert.equal(isLongPack(shortSample as never), false); // an old saved short package has no `kind` field
  });
});
