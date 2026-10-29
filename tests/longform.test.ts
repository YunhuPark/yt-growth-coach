import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { longformTarget, MIN_LONGFORM_SOURCE_SEC } from "../src/lib/editor/autoEditJobs";

describe("longformTarget", () => {
  it("aims at about half of the source", () => {
    assert.equal(longformTarget(600), 300);
    assert.equal(longformTarget(1200), 600);
  });

  it("never goes under a minute or over fifteen", () => {
    assert.equal(longformTarget(MIN_LONGFORM_SOURCE_SEC), 60);
    assert.equal(longformTarget(60), 60);
    assert.equal(longformTarget(7200), 900);
  });
});
