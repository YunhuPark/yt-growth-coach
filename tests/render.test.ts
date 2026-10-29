import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { baseFilter, LAYOUTS, MAX_LONG_SEC, MAX_SHORT_SEC, probe, renderVideo } from "../src/lib/editor/render";

const FFMPEG = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const FONTS = [
  "C:/Windows/Fonts/malgunbd.ttf",
  "C:/Windows/Fonts/malgun.ttf",
  "C:/Windows/Fonts/NanumGothic.ttf",
  "/System/Library/Fonts/AppleSDGothicNeo.ttc",
  "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
];
const hasFfmpeg = existsSync(FFMPEG);
const hasFont = FONTS.some((f) => existsSync(f));

describe("layouts", () => {
  it("defines a vertical short frame and a horizontal long frame with different limits", () => {
    assert.deepEqual([LAYOUTS.short.w, LAYOUTS.short.h], [1080, 1920]);
    assert.deepEqual([LAYOUTS.long.w, LAYOUTS.long.h], [1920, 1080]);
    assert.equal(LAYOUTS.short.maxSec, MAX_SHORT_SEC);
    assert.equal(LAYOUTS.long.maxSec, MAX_LONG_SEC);
    assert.ok(LAYOUTS.long.maxSec > LAYOUTS.short.maxSec);
  });

  it("keeps the ending text of a long video in the upper third, leaving room for the end-screen elements", () => {
    assert.equal(LAYOUTS.long.ending.y, "h*0.18");
  });
});

describe("baseFilter", () => {
  it("skips the costly blur when the source already has the frame aspect ratio", () => {
    const f = baseFilter("long", "blur", { width: 1920, height: 1080 });
    assert.match(f, /scale=1920:1080,setsar=1/);
    assert.doesNotMatch(f, /boxblur/);
    assert.doesNotMatch(baseFilter("short", "blur", { width: 1080, height: 1920 }), /boxblur/);
  });

  it("treats a source within 1% of the frame ratio as exact", () => {
    assert.doesNotMatch(baseFilter("long", "blur", { width: 1920, height: 1088 }), /boxblur/);
  });

  it("blurs a mismatched source, and crops when asked to fill the frame", () => {
    assert.match(baseFilter("long", "blur", { width: 1080, height: 1920 }), /boxblur/); // phone video in a horizontal frame
    assert.match(baseFilter("short", "blur", { width: 1920, height: 1080 }), /boxblur/);
    assert.match(baseFilter("long", "cover", { width: 1080, height: 1920 }), /crop=1920:1080/);
  });

  it("falls back to the blur layout when the source size is unknown", () => {
    assert.match(baseFilter("short", "blur", undefined), /boxblur/);
  });
});

// A render that hangs must fail the test rather than stall the whole suite.
describe("rendering with ffmpeg", { skip: !hasFfmpeg || !hasFont ? "needs the bundled ffmpeg and a Korean font" : false, timeout: 120_000 }, () => {
  let dir: string;
  const make = (name: string, args: string[]) => {
    const out = path.join(dir, name);
    const r = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...args, out]);
    assert.equal(r.status, 0, String(r.stderr));
    return out;
  };

  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ytgc-render-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("reads duration and frame size", async () => {
    const src = make("a.mp4", ["-f", "lavfi", "-i", "testsrc2=s=320x180:r=10:d=2", "-pix_fmt", "yuv420p"]);
    const info = await probe(src, dir);
    assert.ok(Math.abs(info.duration - 2) < 0.2);
    assert.deepEqual([info.width, info.height], [320, 180]);
  });

  it("swaps the size for phone footage stored sideways with a rotation tag", async () => {
    const plain = make("b.mp4", ["-f", "lavfi", "-i", "testsrc2=s=320x180:r=10:d=1", "-pix_fmt", "yuv420p"]);
    const rotated = make("b-rot.mp4", ["-display_rotation:v:0", "90", "-i", plain, "-c", "copy"]);
    const info = await probe(rotated, dir);
    assert.deepEqual([info.width, info.height], [180, 320]);
  });

  it("renders a horizontal source as a 1080x1920 short and reports progress up to 100%", async () => {
    const src = make("c.mp4", ["-f", "lavfi", "-i", "testsrc2=s=640x360:r=15:d=3", "-pix_fmt", "yuv420p"]);
    const seen: number[] = [];
    const work = path.join(dir, "short");
    const r = await renderVideo(
      src,
      work,
      { layout: "short", fit: "blur", hook: { text: "테스트 훅", seconds: 1 }, captions: [], ending: { text: "구독", seconds: 1 } },
      (f) => seen.push(f),
    );
    const out = await probe(path.join(work, "output.mp4"), work);
    assert.deepEqual([out.width, out.height], [1080, 1920]);
    assert.equal(r.layout, "short");
    assert.equal(seen.at(-1), 1);
    assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), "progress never goes backwards");
  });

  it("renders a vertical phone video as a 1920x1080 long-form frame", async () => {
    const src = make("d.mp4", ["-f", "lavfi", "-i", "testsrc2=s=360x640:r=15:d=3", "-pix_fmt", "yuv420p"]);
    const work = path.join(dir, "long");
    const r = await renderVideo(src, work, { layout: "long", fit: "blur", captions: [{ start: 0.5, end: 2, text: "챕터 제목" }] });
    const out = await probe(path.join(work, "output.mp4"), work);
    assert.deepEqual([out.width, out.height], [1920, 1080]);
    assert.equal(r.layout, "long");
  });

  it("applies the short limit to shorts but not to long-form", async () => {
    // 190 s at 1 fps is cheap to make and to encode.
    const src = make("e.mp4", [
      "-f", "lavfi", "-i", "color=c=black:s=64x64:r=1:d=190",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    ]);
    await assert.rejects(renderVideo(src, path.join(dir, "toolong"), { layout: "short", fit: "blur", captions: [] }), /쇼츠는 180초/);
    const r = await renderVideo(src, path.join(dir, "ok-long"), { layout: "long", fit: "blur", captions: [] });
    assert.ok(r.durationSec > 180);
  });

  it("writes the caption text file for the overlay", async () => {
    const src = make("f.mp4", ["-f", "lavfi", "-i", "testsrc2=s=640x360:r=10:d=4", "-pix_fmt", "yuv420p"]);
    const work = path.join(dir, "overlay");
    await renderVideo(src, work, {
      layout: "short",
      fit: "blur",
      captions: [{ start: 0, end: 4, text: "자막" }],
      ending: { text: "끝", seconds: 1.5 },
    });
    assert.equal(readFileSync(path.join(work, "t0.txt"), "utf8"), "자막");
  });
});
