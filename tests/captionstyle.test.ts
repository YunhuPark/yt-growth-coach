import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { DEFAULT_STYLE, normalizeStyle, PRESETS, styledText, type CaptionStyle } from "../src/lib/editor/captionStyle";
import { LAYOUTS, renderVideo } from "../src/lib/editor/render";

const SHORT = LAYOUTS.short;

describe("the default style", () => {
  it("is exactly what the renderer used before styles existed", () => {
    const cap = styledText("caption", SHORT.caption, DEFAULT_STYLE, "short");
    assert.equal(cap.options, "fontsize=58:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=22:x=(w-text_w)/2:y=h*0.70:line_spacing=12");
    assert.equal(cap.wrap, 13);
    const hook = styledText("hook", SHORT.hook, DEFAULT_STYLE, "short");
    assert.equal(hook.options, "fontsize=76:fontcolor=white:borderw=7:bordercolor=black@0.9:x=(w-text_w)/2:y=h*0.10:line_spacing=16");
    assert.equal(hook.wrap, 12);
    const long = styledText("caption", LAYOUTS.long.caption, DEFAULT_STYLE, "long");
    assert.equal(long.options, "fontsize=44:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=16:x=(w-text_w)/2:y=h*0.80:line_spacing=8");
  });
});

describe("presets", () => {
  const cap = (preset: CaptionStyle["preset"], extra: Partial<CaptionStyle> = {}) =>
    styledText("caption", SHORT.caption, { ...DEFAULT_STYLE, preset, ...extra }, "short");

  it("outline has no box and a thick dark edge", () => {
    const o = cap("outline").options;
    assert.match(o, /fontcolor=white/);
    assert.match(o, /borderw=\d+:bordercolor=black@0\.95/);
    assert.doesNotMatch(o, /box=1/);
  });

  it("yellow is outlined yellow text, and also colours the hook", () => {
    assert.match(cap("yellow").options, /fontcolor=0xFFE600/);
    const hook = styledText("hook", SHORT.hook, { ...DEFAULT_STYLE, preset: "yellow" }, "short").options;
    assert.match(hook, /fontcolor=0xFFE600/);
    assert.match(hook, /bordercolor=black@0\.9/);
  });

  it("minimal is smaller text in a fainter box", () => {
    const m = cap("minimal");
    assert.match(m.options, /boxcolor=black@0\.35/);
    assert.ok(Number(/fontsize=(\d+)/.exec(m.options)![1]) < 58);
    assert.ok(m.wrap > 13, "smaller letters fit more on a line");
  });

  it("every preset keeps the hook readable (outlined) and leaves its place alone", () => {
    for (const preset of PRESETS) {
      const h = styledText("hook", SHORT.hook, { ...DEFAULT_STYLE, preset, position: "top" }, "short").options;
      assert.match(h, /borderw=\d+/);
      assert.match(h, /y=h\*0\.10/, `${preset}: the position setting is for captions, not the hook`);
    }
  });
});

describe("position and size", () => {
  it("moves captions to the middle or below the hook at the top", () => {
    assert.match(styledText("caption", SHORT.caption, { ...DEFAULT_STYLE, position: "middle" }, "short").options, /y=\(h-text_h\)\/2/);
    assert.match(styledText("caption", SHORT.caption, { ...DEFAULT_STYLE, position: "top" }, "short").options, /y=h\*0\.24/);
    assert.match(styledText("caption", LAYOUTS.long.caption, { ...DEFAULT_STYLE, position: "top" }, "long").options, /y=h\*0\.18/);
  });

  it("scales the letters and the line spacing, and wraps sooner when they are bigger", () => {
    const big = styledText("caption", SHORT.caption, { ...DEFAULT_STYLE, scale: 1.25 }, "short");
    const small = styledText("caption", SHORT.caption, { ...DEFAULT_STYLE, scale: 0.8 }, "short");
    assert.match(big.options, /fontsize=73:/);
    assert.match(small.options, /fontsize=46:/);
    assert.ok(big.wrap < 13 && small.wrap > 13);
  });

  it("never lets the letters get unreadably small", () => {
    assert.match(styledText("caption", { size: 10, y: "h*0.7", wrap: 13, spacing: 1 }, { ...DEFAULT_STYLE, scale: 0.6 }, "short").options, /fontsize=16:/);
  });
});

describe("normalizeStyle", () => {
  it("falls back to the default for anything it does not know, and keeps the size in range", () => {
    assert.deepEqual(normalizeStyle(undefined), DEFAULT_STYLE);
    assert.deepEqual(normalizeStyle({ preset: "neon" as never, position: "side" as never, scale: Number.NaN }), DEFAULT_STYLE);
    assert.equal(normalizeStyle({ scale: 99 }).scale, 1.6);
    assert.equal(normalizeStyle({ scale: 0.01 }).scale, 0.6);
    assert.equal(normalizeStyle({ scale: -3 }).scale, 1);
    assert.deepEqual(normalizeStyle({ preset: "outline", position: "top", scale: 1.25 }), { preset: "outline", position: "top", scale: 1.25 });
  });
});

const FFMPEG = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const FONTS = ["C:/Windows/Fonts/malgunbd.ttf", "C:/Windows/Fonts/malgun.ttf", "C:/Windows/Fonts/NanumGothic.ttf", "/System/Library/Fonts/AppleSDGothicNeo.ttc", "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf"];

describe("rendering with a style", { skip: !existsSync(FFMPEG) || !FONTS.some((f) => existsSync(f)) ? "needs the bundled ffmpeg and a Korean font" : false, timeout: 180_000 }, () => {
  let dir: string;
  let src: string;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ytgc-style-"));
    src = path.join(dir, "src.mp4");
    const r = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x335577:s=640x360:r=10:d=3", "-pix_fmt", "yuv420p", src]);
    assert.equal(r.status, 0, String(r.stderr));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  /** A hash of the frame at 1.5 s, so two renders can be told apart by what is actually on screen. */
  async function frameOf(name: string, style?: CaptionStyle) {
    const work = path.join(dir, name);
    await renderVideo(src, work, { layout: "short", fit: "blur", style, hook: { text: "훅 자막", seconds: 3 }, captions: [{ start: 0, end: 3, text: "여기에 자막이 나옵니다" }] });
    const png = path.join(work, "f.png");
    const r = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-ss", "1.5", "-i", path.join(work, "output.mp4"), "-frames:v", "1", png]);
    assert.equal(r.status, 0, String(r.stderr));
    return createHash("sha1").update(readFileSync(png)).digest("hex");
  }

  it("draws a visibly different frame for each preset, position and size, and the default matches no style", async () => {
    const none = await frameOf("none");
    const dflt = await frameOf("default", DEFAULT_STYLE);
    assert.equal(dflt, none, "passing the default style changes nothing");
    const seen = new Set([none]);
    for (const [name, style] of [
      ["outline", { ...DEFAULT_STYLE, preset: "outline" }],
      ["yellow", { ...DEFAULT_STYLE, preset: "yellow" }],
      ["minimal", { ...DEFAULT_STYLE, preset: "minimal" }],
      ["top", { ...DEFAULT_STYLE, position: "top" }],
      ["middle", { ...DEFAULT_STYLE, position: "middle" }],
      ["big", { ...DEFAULT_STYLE, scale: 1.25 }],
    ] as [string, CaptionStyle][]) {
      const h = await frameOf(name, style);
      assert.ok(!seen.has(h), `${name} looks the same as an earlier one`);
      seen.add(h);
    }
  });
});
