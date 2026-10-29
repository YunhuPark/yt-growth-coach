import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keepSegments } from "../src/lib/editor/cutPlan";
import type { Span } from "../src/lib/editor/retention";
import { previewRange, removalsFromCliffs, shortFromRewatch, spanSeconds } from "../src/lib/editor/retentionActions";

const span = (fromSec: number | null, toSec: number | null, points = 10): Span => ({ fromPct: 40, toPct: 42, fromSec, toSec, points });

describe("spanSeconds", () => {
  it("is null without the length of the video, or for an empty span", () => {
    assert.equal(spanSeconds(span(null, null), null), null);
    assert.equal(spanSeconds(span(50, 50), 600), null);
  });
  it("keeps the span inside the video", () => {
    assert.deepEqual(spanSeconds(span(590, 620), 600), { start: 590, end: 600 });
    assert.deepEqual(spanSeconds(span(-2, 10), 600), { start: 0, end: 10 });
  });
});

describe("previewRange", () => {
  it("adds a few seconds around, never outside the video", () => {
    assert.deepEqual(previewRange(span(100, 112), 600), { start: 97, end: 115 });
    assert.deepEqual(previewRange(span(1, 4), 600), { start: 0, end: 7 });
    assert.deepEqual(previewRange(span(595, 599), 600), { start: 592, end: 600 });
    assert.equal(previewRange(span(null, null), 600), null);
  });
});

describe("shortFromRewatch", () => {
  it("starts just before the rise and runs for the chosen length", () => {
    assert.deepEqual(shortFromRewatch(span(200, 212), 600, 30), { start: 198, end: 228 });
  });
  it("slides back from the end of the video so the Short is not cut off", () => {
    assert.deepEqual(shortFromRewatch(span(590, 598), 600, 30), { start: 570, end: 600 });
    assert.deepEqual(shortFromRewatch(span(580, 590), 600, 30), { start: 570, end: 600 });
  });
  it("is null when the video is too short or its length unknown", () => {
    assert.equal(shortFromRewatch(span(3, 5), 6, 30), null);
    assert.equal(shortFromRewatch(span(200, 212), null, 30), null);
  });
});

describe("removalsFromCliffs", () => {
  it("turns drops into cuts that leave the rest of the video", () => {
    const removals = removalsFromCliffs([span(100, 112), span(300, 320), span(null, null)], 600);
    assert.equal(removals.length, 2);
    assert.deepEqual(keepSegments(600, removals), [
      { start: 0, end: 100 },
      { start: 112, end: 300 },
      { start: 320, end: 600 },
    ]);
  });
});
