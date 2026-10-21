// Runs in a temp working directory (the pictures are written under .data/previews of the cwd) with the real ffmpeg.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const originalCwd = process.cwd();
const FFMPEG = path.join(originalCwd, "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const FONTS = ["C:/Windows/Fonts/malgunbd.ttf", "C:/Windows/Fonts/malgun.ttf", "C:/Windows/Fonts/NanumGothic.ttf", "/System/Library/Fonts/AppleSDGothicNeo.ttc", "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf"];

describe("styleKey", () => {
  it("is stable for the same layout and style and differs when anything changes", async () => {
    const { styleKey } = await import("../src/lib/stylePreview");
    const base = { preset: "box", position: "bottom", scale: 1 } as const;
    const k = styleKey("short", base);
    assert.match(k, /^[a-f0-9]{16}$/);
    assert.equal(k, styleKey("short", { ...base }));
    assert.notEqual(k, styleKey("long", base));
    assert.notEqual(k, styleKey("short", { ...base, preset: "outline" }));
    assert.notEqual(k, styleKey("short", { ...base, position: "top" }));
    assert.notEqual(k, styleKey("short", { ...base, scale: 1.25 }));
  });
});

describe("makeStylePreview", { skip: !existsSync(FFMPEG) || !FONTS.some((f) => existsSync(f)) ? "needs the bundled ffmpeg and a Korean font" : false, timeout: 120_000 }, () => {
  let tmp: string;
  let mod: typeof import("../src/lib/stylePreview");

  before(async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "ytgc-stylepic-"));
    process.chdir(tmp);
    mod = await import("../src/lib/stylePreview");
  });
  after(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  const sha = (f: string) => createHash("sha1").update(readFileSync(f)).digest("hex");

  it("draws a PNG per style, different for each, and the same file again for the same style", async () => {
    const a = await mod.makeStylePreview("short", { preset: "box" });
    const b = await mod.makeStylePreview("short", { preset: "outline" });
    const c = await mod.makeStylePreview("short", { preset: "box", position: "top" });
    for (const f of [a, b, c]) {
      assert.ok(readFileSync(f).subarray(1, 4).toString() === "PNG", "a PNG file");
      assert.ok(readFileSync(f).length > 1000);
    }
    assert.equal(new Set([sha(a), sha(b), sha(c)]).size, 3);
    const again = await mod.makeStylePreview("short", { preset: "box" });
    assert.equal(again, a);
  });

  it("is a vertical picture for shorts and a horizontal one for long-form", async () => {
    const s = readFileSync(await mod.makeStylePreview("short", {}));
    const l = readFileSync(await mod.makeStylePreview("long", {}));
    const size = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)];
    const [sw, sh] = size(s);
    const [lw, lh] = size(l);
    assert.ok(sh > sw && lw > lh, `short ${sw}x${sh}, long ${lw}x${lh}`);
    assert.equal(sw, 360);
    assert.equal(lw, 640);
  });

  it("treats unknown values as the default instead of failing, and leaves only the finished pictures behind", async () => {
    const odd = await mod.makeStylePreview("short", { preset: "neon" as never, position: "side" as never, scale: Number.NaN });
    const dflt = await mod.makeStylePreview("short", {});
    assert.equal(odd, dflt);
    const left = readdirSync(mod.stylePreviewFile("short", { preset: "box", position: "bottom", scale: 1 }).replace(/[^\\/]+$/, ""));
    assert.ok(left.every((f) => f.endsWith(".png") && !f.includes(".part")), `left behind: ${left.join(", ")}`);
  });
});
