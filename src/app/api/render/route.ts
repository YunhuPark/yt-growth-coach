import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { rendersDir, startRenderJob } from "@/lib/renderJobs";

const MAX_UPLOAD = 600 * 1024 * 1024;
const EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);

const Options = z.object({
  layout: z.enum(["short", "long"]).default("short"),
  fit: z.enum(["blur", "cover"]),
  trimStart: z.number().min(0).max(14400).optional(),
  trimEnd: z.number().min(0).max(14400).optional(),
  hook: z.object({ text: z.string().max(120), seconds: z.number().min(0.5).max(10) }).optional(),
  captions: z.array(z.object({ start: z.number().min(0), end: z.number().min(0), text: z.string().max(120) })).max(60),
  ending: z.object({ text: z.string().max(60), seconds: z.number().min(0.5).max(20) }).optional(),
  // For files too large to upload: an absolute path on this computer. Only video files are read.
  sourcePath: z.string().max(500).optional(),
  // Rendering is only offered for footage the creator has the right to use.
  rights: z.object({
    confirmed: z.literal(true),
    basis: z.enum(["own_footage", "licensed", "rights_holder_permission"]),
  }),
});

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    let raw: unknown;
    try {
      raw = JSON.parse(String(form.get("options") ?? "{}"));
    } catch {
      return Response.json({ error: "옵션 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const parsed = Options.safeParse(raw);
    if (!parsed.success) {
      const noRights = parsed.error.issues.some((i) => i.path[0] === "rights");
      return Response.json(
        { error: noRights ? "영상 사용 권한 확인에 체크해야 렌더링할 수 있습니다." : "입력값을 확인해 주세요." },
        { status: 400 },
      );
    }
    const { sourcePath: rawPath, ...opts } = parsed.data;
    const sourcePath = rawPath?.trim().replace(/^"(.*)"$/, "$1"); // Explorer's "copy as path" adds quotes

    const id = randomBytes(8).toString("hex");
    const dir = path.join(rendersDir(), id);
    let input: string;
    let sourceName: string;
    let deleteInput = false;

    if (sourcePath) {
      if (!path.isAbsolute(sourcePath)) return Response.json({ error: "파일 경로는 드라이브 문자부터 시작하는 전체 경로여야 합니다." }, { status: 400 });
      if (!EXT.has(path.extname(sourcePath).toLowerCase())) {
        return Response.json({ error: "mp4, mov, webm, mkv 파일만 사용할 수 있습니다." }, { status: 400 });
      }
      const st = await fs.stat(sourcePath).catch(() => null);
      if (!st?.isFile()) return Response.json({ error: "해당 경로에서 파일을 찾지 못했습니다." }, { status: 400 });
      input = sourcePath;
      sourceName = path.basename(sourcePath);
    } else if (file instanceof File) {
      const ext = path.extname(file.name).toLowerCase();
      if (!EXT.has(ext)) return Response.json({ error: "mp4, mov, webm, mkv 파일만 올릴 수 있습니다." }, { status: 400 });
      if (file.size > MAX_UPLOAD) {
        return Response.json({ error: "업로드는 600MB까지입니다. 더 큰 파일은 파일 경로를 입력해 주세요." }, { status: 400 });
      }
      await fs.mkdir(dir, { recursive: true });
      input = path.join(dir, `input${ext}`);
      await fs.writeFile(input, Buffer.from(await file.arrayBuffer()));
      sourceName = file.name;
      deleteInput = true; // the creator keeps the original; don't hold a second copy
    } else {
      return Response.json({ error: "영상 파일을 선택하거나 파일 경로를 입력해 주세요." }, { status: 400 });
    }

    startRenderJob({ id, dir, input, opts, meta: { sourceName, ...opts }, deleteInput });
    return Response.json({ id }, { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}
