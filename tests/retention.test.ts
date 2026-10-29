import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCues, parseNumber, parseRetention, placeOf, readRetention, saidAt, valueAt, type Curve } from "../src/lib/retention";

/** A curve over 0-100 % of the video, one point per percent, built from a function of the position. */
const curve = (f: (pct: number) => number, unit: Curve["unit"] = "percent", scale = 1): Curve => ({
  unit,
  points: Array.from({ length: 101 }, (_, i) => ({ x: i * scale, y: f(i) })),
});

describe("parseNumber", () => {
  it("reads percents, thousands, clock times and decimal commas", () => {
    assert.equal(parseNumber("98.5%"), 98.5);
    assert.equal(parseNumber(" 1,234 "), 1234);
    assert.equal(parseNumber("1:05"), 65);
    assert.equal(parseNumber("1:02:03"), 3723);
    assert.equal(parseNumber("0,5", true), 0.5);
    assert.equal(parseNumber("1.234,5", true), 1234.5);
  });
  it("says no to text", () => {
    assert.equal(parseNumber("Video position (%)"), null);
    assert.equal(parseNumber(""), null);
    assert.equal(parseNumber("abc1"), null);
  });
});

describe("parseRetention", () => {
  const csv = (rows: [string, string][], header = "Video position (%),Absolute audience retention (%)") => [header, ...rows.map((r) => r.join(","))].join("\n");
  const rows = (n = 12): [string, string][] => Array.from({ length: n }, (_, i) => [`${i * 10}%`, `${100 - i * 3}%`] as [string, string]);

  it("skips the header, strips percent signs and sorts by position", () => {
    const r = parseRetention(csv(rows(12).reverse()));
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.curve.unit, "seconds", "110 is past 100, so the first column cannot be a percent");
      assert.equal(r.curve.points[0].x, 0);
      assert.equal(r.skipped, 1);
    }
  });
  it("knows a percent axis, a ratio axis and clock times", () => {
    const pct = parseRetention(csv(rows(11)));
    assert.ok(pct.ok && pct.curve.unit === "percent" && pct.curve.points[10].x === 100);
    const ratio = parseRetention(Array.from({ length: 11 }, (_, i) => `${i / 10},${1 - i * 0.03}`).join("\n"));
    assert.ok(ratio.ok && ratio.curve.unit === "percent");
    if (ratio.ok) {
      assert.equal(ratio.curve.points[10].x, 100);
      assert.ok(Math.abs(ratio.curve.points[0].y - 100) < 1e-9, "a retention that starts at 1 becomes 100 %");
    }
    const clock = parseRetention(Array.from({ length: 10 }, (_, i) => `0:${String(i * 5).padStart(2, "0")},${100 - i * 4}`).join("\n"));
    assert.ok(clock.ok && clock.curve.unit === "seconds" && clock.curve.points[9].x === 45);
  });
  it("lets the creator say it is seconds when a short video would look like percent", () => {
    const text = Array.from({ length: 10 }, (_, i) => `${i * 5},${100 - i * 4}`).join("\n");
    const auto = parseRetention(text);
    assert.ok(auto.ok && auto.curve.unit === "percent");
    const secs = parseRetention(text, "seconds");
    assert.ok(secs.ok && secs.curve.unit === "seconds");
  });
  it("reads tab and semicolon (decimal comma) exports", () => {
    const tab = parseRetention(Array.from({ length: 9 }, (_, i) => `${i * 10}\t${90 - i}`).join("\n"));
    assert.ok(tab.ok && tab.curve.points.length === 9);
    const semi = parseRetention(Array.from({ length: 9 }, (_, i) => `${i * 10};${(90 - i * 0.5).toString().replace(".", ",")}`).join("\n"));
    assert.ok(semi.ok && semi.curve.points[1].y === 89.5);
  });
  it("takes the first two numbers of a row when the export has more columns", () => {
    const text = ["동영상 위치(%),절대 시청 지속률(%),상대 시청 지속률(%)", ...Array.from({ length: 10 }, (_, i) => `${i * 10}%,${100 - i * 5}%,${52 + i}%`)].join("\n");
    const r = parseRetention(text);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.curve.points[3].y, 85, "the second column, not the third");
      assert.equal(r.skipped, 1);
    }
  });
  it("explains what is wrong", () => {
    const empty = parseRetention("");
    assert.ok(!empty.ok && /없습니다/.test(empty.error));
    const few = parseRetention("0,100\n10,90\n20,80");
    assert.ok(!few.ok && /8개 이상/.test(few.error));
    const neg = parseRetention(Array.from({ length: 9 }, (_, i) => `${i * 10},${50 - i * 10}`).join("\n"));
    assert.ok(!neg.ok && /음수/.test(neg.error));
  });
  it("keeps one value for a repeated position", () => {
    const r = parseRetention(["0,100", "0,99", ...Array.from({ length: 9 }, (_, i) => `${(i + 1) * 10},${95 - i}`)].join("\n"));
    assert.ok(r.ok && r.curve.points.filter((p) => p.x === 0).length === 1);
  });
});

describe("valueAt", () => {
  it("interpolates and holds at the ends", () => {
    const pts = [{ x: 0, y: 100 }, { x: 10, y: 80 }, { x: 20, y: 60 }];
    assert.equal(valueAt(pts, 5), 90);
    assert.equal(valueAt(pts, -3), 100);
    assert.equal(valueAt(pts, 99), 60);
  });
});

describe("readRetention", () => {
  it("calls an evenly sliding video healthy and points to the packaging", () => {
    const r = readRetention(curve((p) => 100 - 0.4 * p));
    assert.equal(r.hookVerdict, "healthy");
    assert.deepEqual(r.cliffs, []);
    assert.equal(r.main.kind, "packaging");
    assert.ok(Math.abs(r.slidePer10Pct - 4) < 0.2, `slide ${r.slidePer10Pct}`);
    assert.equal(r.start, 100);
  });

  it("finds a leaking opening and puts it first", () => {
    const r = readRetention(curve((p) => (p <= 10 ? 100 - 5 * p : 50 - 0.2 * (p - 10))));
    assert.equal(r.hookVerdict, "severe");
    assert.ok(r.hookLeak >= 40, `leak ${r.hookLeak}`);
    assert.equal(r.main.kind, "hook");
    assert.match(r.main.title, /빠져나갑니다/);
    assert.deepEqual(r.cliffs, [], "the opening drop is the hook leak, not also a cliff");
  });

  it("finds a single steep drop in the middle, where it is", () => {
    const r = readRetention(curve((p) => 100 - 0.3 * p - (p > 56 ? 12 : p > 55 ? 6 : 0)));
    assert.equal(r.hookVerdict, "healthy");
    assert.equal(r.cliffs.length, 1);
    const c = r.cliffs[0];
    assert.ok(c.fromPct >= 54 && c.toPct <= 58, `${c.fromPct}-${c.toPct}`);
    assert.ok(Math.abs(c.points - 12) < 1.5, `lost ${c.points}`);
    assert.equal(r.main.kind, "cliff");
    assert.match(placeOf(c), /55% 지점부터|56% 지점부터|54% 지점부터/);
  });

  it("talks in seconds when it knows how long the video is", () => {
    const r = readRetention(curve((p) => 100 - 0.3 * p - (p > 50 ? 12 : 0)), 600);
    assert.equal(r.durationSec, 600);
    const c = r.cliffs[0];
    assert.ok(c.fromSec !== null && Math.abs(c.fromSec - 300) <= 12, `at ${c.fromSec}`);
    assert.match(placeOf(c), /^\d+:\d{2}부터$/);
    assert.equal(r.hookWindow.sec, 30);
  });

  it("takes the length from the last point when the export is by seconds", () => {
    const r = readRetention(curve((p) => 100 - 0.3 * p, "seconds", 6));
    assert.equal(r.durationSec, 600);
  });

  it("keeps the opening window to a fifth of a short video", () => {
    const r = readRetention(curve((p) => 100 - 0.3 * p), 40);
    assert.equal(r.hookWindow.pct, 20);
    assert.equal(r.hookWindow.sec, 8);
  });

  it("finds where viewers came back", () => {
    const r = readRetention(curve((p) => 100 - 0.4 * p + (p > 70 && p <= 73 ? (p - 70) * 2 : p > 73 ? 6 : 0)));
    assert.equal(r.rewatches.length, 1);
    assert.ok(r.rewatches[0].fromPct >= 69 && r.rewatches[0].toPct <= 74);
    assert.ok(r.rewatches[0].points >= 4.5, `won back ${r.rewatches[0].points}`);
  });

  it("names a heavy steady drain as a pacing problem", () => {
    const r = readRetention(curve((p) => 100 - 0.85 * p));
    assert.equal(r.hookVerdict, "healthy");
    assert.deepEqual(r.cliffs, []);
    assert.equal(r.main.kind, "slide");
    assert.ok(r.slidePer10Pct >= 8);
  });

  it("gives the drain per minute when the length is known", () => {
    const r = readRetention(curve((p) => 100 - 0.5 * p), 300);
    assert.ok(r.slidePerMin !== null && Math.abs(r.slidePerMin - 10) < 0.5, `per min ${r.slidePerMin}`);
  });

  it("handles a curve with few, unevenly spaced points", () => {
    const pts = [0, 4, 9, 15, 30, 55, 80, 100].map((x, i) => ({ x, y: 100 - i * 8 }));
    const r = readRetention({ unit: "percent", points: pts });
    assert.equal(r.start, 100);
    assert.equal(r.end, 44);
    assert.ok(Number.isFinite(r.slidePer10Pct));
  });
});

describe("what was said", () => {
  const srt = [
    "1", "00:00:01,000 --> 00:00:03,500", "안녕하세요 여러분", "",
    "2", "00:04:58,200 --> 00:05:02,000", "그럼 광고 먼저 보고 가겠습니다", "",
    "3", "00:05:02,000 --> 00:05:06,000", "<i>이 제품은</i> 정말 좋아요", "",
  ].join("\n");
  it("reads SRT cues, with commas or dots in the times, and tags dropped", () => {
    const cues = parseCues(srt);
    assert.equal(cues.length, 3);
    assert.equal(cues[1].start, 298.2);
    assert.equal(cues[2].text, "이 제품은 정말 좋아요");
    assert.equal(parseCues("WEBVTT\n\n00:00:01.500 --> 00:00:02.000\n안녕\n")[0].start, 1.5);
  });
  it("tells what was being said near a moment", () => {
    const cues = parseCues(srt);
    assert.match(saidAt(cues, 300, 301), /광고 먼저.*이 제품은/);
    assert.equal(saidAt(cues, 100, 101), "");
    assert.ok(saidAt(cues, 300, 301, 4, 10).endsWith("…"));
  });
});
