import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { probe, run } from "./render";

// A quick, small copy of one stretch of the source so a candidate can be watched before the real render. It is the plain
// source picture at low resolution (no hook, captions or vertical frame): it answers "is this the right moment?", not
// "how will the result look?".

export const MAX_PREVIEW_SEC = 95;
const KEEP_MS = 24 * 3600_000;

export const previewsDir = () => path.join(process.cwd(), ".data", "previews");
export const previewFile = (id: string) => path.join(previewsDir(), `${id}.mp4`);

/** Same source file, same range -> same id, so asking again is instant. */
export function previewId(input: string, mtimeMs: number, start: number, end: number): string {
  return createHash("sha1").update(`${input}|${mtimeMs}|${start.toFixed(2)}|${end.toFixed(2)}`).digest("hex").slice(0, 16);
}

/** Removes previews older than a day so the folder doesn't grow without bound. */
export async function pruneOldPreviews(now = Date.now()) {
  try {
    for (const f of await fs.readdir(previewsDir())) {
      const p = path.join(previewsDir(), f);
      const st = await fs.stat(p);
      if (now - st.mtimeMs > KEEP_MS) await fs.rm(p, { force: true });
    }
  } catch {
    /* no folder yet */
  }
}

export async function makePreview(input: string, start: number, end: number): Promise<{ id: string; durationSec: number }> {
  if (!(Number.isFinite(start) && Number.isFinite(end)) || start < 0 || end <= start) throw new Error("미리 볼 구간의 시작과 끝을 확인해 주세요.");
  if (end - start > MAX_PREVIEW_SEC) throw new Error(`미리 보기는 ${MAX_PREVIEW_SEC}초까지만 만들 수 있습니다.`);

  const st = await fs.stat(input);
  const id = previewId(input, st.mtimeMs, start, end);
  const out = previewFile(id);
  await fs.mkdir(previewsDir(), { recursive: true });
  await pruneOldPreviews();

  try {
    await fs.access(out);
    return { id, durationSec: Math.round((end - start) * 10) / 10 };
  } catch {
    /* not made yet */
  }

  const info = await probe(input, previewsDir());
  if (start >= info.duration) throw new Error("시작 시각이 영상 길이를 넘었습니다.");
  const to = Math.min(end, info.duration);
  const tmp = path.join(previewsDir(), `${id}.part.mp4`);
  const { code, stderr } = await run(
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-ss", start.toFixed(2), "-i", input, "-t", (to - start).toFixed(2),
      "-vf", "scale=-2:360", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "32", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart",
      tmp,
    ],
    previewsDir(),
    5 * 60_000,
  );
  if (code !== 0) {
    await fs.rm(tmp, { force: true });
    throw new Error(`미리 보기를 만들지 못했습니다: ${stderr.trim().split("\n").slice(-2).join(" ").slice(0, 200)}`);
  }
  await fs.rename(tmp, out); // only a finished file ever has the final name
  return { id, durationSec: Math.round((to - start) * 10) / 10 };
}
