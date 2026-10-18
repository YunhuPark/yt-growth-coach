import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDue, lastDue, nextDue } from "../src/lib/schedule";
import type { Weekly } from "../src/lib/store";

// All dates are built in local time, the same clock the schedule uses.
const at = (month: number, day: number, hour = 0, min = 0) => new Date(2026, month - 1, day, hour, min, 0, 0);
const iso = (d: Date) => d.toISOString();
// 2026-10-18 is a Sunday.
const SUN_10AM = at(10, 18, 10);

describe("lastDue / nextDue", () => {
  it("is today when it is the scheduled weekday and the hour has passed", () => {
    assert.deepEqual(lastDue(SUN_10AM, 0, 9), at(10, 18, 9));
  });

  it("is last week when it is the scheduled weekday but the hour has not come yet", () => {
    assert.deepEqual(lastDue(SUN_10AM, 0, 11), at(10, 11, 11));
  });

  it("goes back to the most recent matching weekday otherwise", () => {
    assert.deepEqual(lastDue(SUN_10AM, 3, 9), at(10, 14, 9)); // Wednesday
    assert.deepEqual(lastDue(SUN_10AM, 6, 22), at(10, 17, 22)); // Saturday evening
  });

  it("is exactly on the boundary at the scheduled minute", () => {
    assert.deepEqual(lastDue(at(10, 18, 9, 0), 0, 9), at(10, 18, 9));
    assert.deepEqual(lastDue(at(10, 18, 8, 59), 0, 9), at(10, 11, 9));
  });

  it("nextDue is one week after the last scheduled moment", () => {
    assert.deepEqual(nextDue(SUN_10AM, 0, 9), at(10, 25, 9));
    assert.deepEqual(nextDue(SUN_10AM, 3, 9), at(10, 21, 9));
  });

  it("crosses month and year ends", () => {
    // Friday 2026-01-02: the most recent Sunday is 2025-12-28.
    assert.deepEqual(lastDue(at(1, 2, 12), 0, 9), new Date(2025, 11, 28, 9));
  });
});

describe("isDue", () => {
  const w = (over: Partial<Weekly> = {}): Weekly => ({ enabled: true, day: 0, hour: 9, ...over });

  it("is never due when switched off", () => {
    assert.equal(isDue(SUN_10AM, undefined, w({ enabled: false })), false);
  });

  it("is due once a scheduled moment has passed since the last run", () => {
    assert.equal(isDue(SUN_10AM, iso(at(10, 11, 9, 5)), w()), true); // last ran last Sunday morning
  });

  it("is not due again after it already ran for this slot", () => {
    assert.equal(isDue(SUN_10AM, iso(at(10, 18, 9, 1)), w()), false);
    assert.equal(isDue(at(10, 21, 15), iso(at(10, 18, 9, 1)), w()), false); // still the same week
  });

  it("catches up after the computer was off at the scheduled time, but only once", () => {
    const lastRun = iso(at(10, 11, 9, 5));
    assert.equal(isDue(at(10, 20, 8), lastRun, w()), true); // Tuesday, the Sunday slot was missed
    assert.equal(isDue(at(10, 20, 8), iso(at(10, 20, 8, 1)), w()), false); // ran at start-up, done for the week
  });

  it("waits for the next slot when it was just switched on, instead of firing immediately", () => {
    const since = iso(at(10, 18, 10)); // switched on Sunday 10:00, after the 9:00 slot
    assert.equal(isDue(at(10, 18, 10, 30), undefined, w({ since })), false);
    assert.equal(isDue(at(10, 25, 9, 1), undefined, w({ since })), true); // the following Sunday 9:00 has passed
  });

  it("treats a missing last run as 'never ran'", () => {
    assert.equal(isDue(SUN_10AM, undefined, w()), true);
  });
});
