import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const MAX_UPLOAD = 600 * 1024 * 1024;
const EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);

/** Rendering and analysis are only offered for footage the creator has the right to use. */
export const Rights = z.object({
  confirmed: z.literal(true),
  basis: z.enum(["own_footage", "licensed", "rights_holder_permission"]),
});

export type Source = { input: string; sourceName: string; deleteInput: boolean };
export class SourceError extends Error {}

/**
 * Where the video comes from: an uploaded file (written into `dir`, deleted afterwards) or an absolute path on this
 * computer (read in place, never deleted). Only video file types are accepted either way.
 */
export async function acceptSource(args: { file: unknown; sourcePath?: string; dir: string }): Promise<Source> {
  const sourcePath = args.sourcePath?.trim().replace(/^"(.*)"$/, "$1"); // Explorer's "copy as path" adds quotes
  if (sourcePath) {
    if (!path.isAbsolute(sourcePath)) throw new SourceError("파일 경로는 드라이브 문자부터 시작하는 전체 경로여야 합니다.");
    if (!EXT.has(path.extname(sourcePath).toLowerCase())) throw new SourceError("mp4, mov, webm, mkv 파일만 사용할 수 있습니다.");
    const st = await fs.stat(sourcePath).catch(() => null);
    if (!st?.isFile()) throw new SourceError("해당 경로에서 파일을 찾지 못했습니다.");
    return { input: sourcePath, sourceName: path.basename(sourcePath), deleteInput: false };
  }
  if (args.file instanceof File) {
    const ext = path.extname(args.file.name).toLowerCase();
    if (!EXT.has(ext)) throw new SourceError("mp4, mov, webm, mkv 파일만 올릴 수 있습니다.");
    if (args.file.size > MAX_UPLOAD) throw new SourceError("업로드는 600MB까지입니다. 더 큰 파일은 파일 경로를 입력해 주세요.");
    await fs.mkdir(args.dir, { recursive: true });
    const input = path.join(args.dir, `input${ext}`);
    await fs.writeFile(input, Buffer.from(await args.file.arrayBuffer()));
    // the creator keeps the original; don't hold a second copy
    return { input, sourceName: args.file.name, deleteInput: true };
  }
  throw new SourceError("영상 파일을 선택하거나 파일 경로를 입력해 주세요.");
}
