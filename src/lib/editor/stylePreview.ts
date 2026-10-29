import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeStyle, styledText, type CaptionStyle } from "./captionStyle";
import { findFont, LAYOUTS, run, wrap, type Layout } from "./render";
import { previewsDir } from "./preview";

// A picture of how a caption style will look, drawn with the same drawtext settings the renderer uses, so what the picker
// shows is what the video gets. One frame on a plain background, scaled down.

const HOOK = "훅 자막 미리보기";
const CAPTION = "여기에 자막이 나옵니다 두 줄까지 길어질 수 있어요";

export const styleKey = (layout: Layout, style: CaptionStyle) =>
  createHash("sha1").update(`${layout}|${style.preset}|${style.position}|${style.scale.toFixed(2)}`).digest("hex").slice(0, 16);

export const stylePreviewFile = (layout: Layout, style: CaptionStyle) => path.join(previewsDir(), `style-${styleKey(layout, style)}.png`);

/** Makes (or reuses) the preview picture for a layout and style; returns its path. */
export async function makeStylePreview(layout: Layout, input: Partial<CaptionStyle>): Promise<string> {
  const style = normalizeStyle(input);
  const out = stylePreviewFile(layout, style);
  try {
    await fs.access(out);
    return out;
  } catch {
    /* not made yet */
  }

  const dir = previewsDir();
  await fs.mkdir(dir, { recursive: true });
  // Same arrangement as the renderer: the text goes through UTF-8 files and a font next to them, so no path or Korean text
  // ever meets filter escaping.
  const key = styleKey(layout, style);
  const fontName = `style-${key}.ttf`;
  await fs.copyFile(await findFont(), path.join(dir, fontName));
  const L = LAYOUTS[layout];
  const hook = styledText("hook", L.hook, style, layout);
  const cap = styledText("caption", L.caption, style, layout);
  const hookFile = `style-${key}-h.txt`;
  const capFile = `style-${key}-c.txt`;
  await fs.writeFile(path.join(dir, hookFile), wrap(HOOK, hook.wrap), "utf8");
  await fs.writeFile(path.join(dir, capFile), wrap(CAPTION, cap.wrap), "utf8");

  const draw = (file: string, options: string) => `drawtext=fontfile=${fontName}:textfile=${file}:reload=0:${options}`;
  const width = layout === "short" ? 360 : 640;
  const tmp = path.join(dir, `style-${key}.part.png`);
  try {
    const { code, stderr } = await run(
      [
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", `color=c=0x3a5068:s=${L.w}x${L.h}:r=1:d=1`,
        // a lighter lower half, so light and dark text can both be judged against a plain picture
        "-vf", `drawbox=x=0:y=ih/2:w=iw:h=ih/2:color=0x8aa0b4:t=fill,${draw(hookFile, hook.options)},${draw(capFile, cap.options)},scale=${width}:-2`,
        "-frames:v", "1", tmp,
      ],
      dir,
      60_000,
    );
    if (code !== 0) throw new Error(`스타일 미리보기를 만들지 못했습니다: ${stderr.trim().split("\n").slice(-2).join(" ").slice(0, 200)}`);
    await fs.rename(tmp, out); // only a finished picture ever has the final name
  } finally {
    await fs.rm(tmp, { force: true });
    await Promise.all([fontName, hookFile, capFile].map((f) => fs.rm(path.join(dir, f), { force: true })));
  }
  return out;
}
