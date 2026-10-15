import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { renderVideo } from "@/lib/render";

export const maxDuration = 600;

const MAX_BYTES = 600 * 1024 * 1024;
const EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);

const Options = z.object({
  fit: z.enum(["blur", "cover"]),
  trimStart: z.number().min(0).max(36000).optional(),
  trimEnd: z.number().min(0).max(36000).optional(),
  hook: z.object({ text: z.string().max(120), seconds: z.number().min(0.5).max(6) }).optional(),
  captions: z
    .array(z.object({ start: z.number().min(0), end: z.number().min(0), text: z.string().max(120) }))
    .max(12),
  ending: z.object({ text: z.string().max(60), seconds: z.number().min(0.5).max(4) }).optional(),
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
    if (!(file instanceof File)) return Response.json({ error: "영상 파일을 선택해 주세요." }, { status: 400 });

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
    const ext = path.extname(file.name).toLowerCase();
    if (!EXT.has(ext)) return Response.json({ error: "mp4, mov, webm, mkv 파일만 올릴 수 있습니다." }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: "파일이 너무 큽니다. (최대 600MB)" }, { status: 400 });

    const id = randomBytes(8).toString("hex");
    const dir = path.join(process.cwd(), ".data", "renders", id);
    await fs.mkdir(dir, { recursive: true });
    const input = path.join(dir, `input${ext}`);
    await fs.writeFile(input, Buffer.from(await file.arrayBuffer()));

    try {
      const result = await renderVideo(input, dir, parsed.data);
      await fs.writeFile(
        path.join(dir, "meta.json"),
        JSON.stringify({ at: new Date().toISOString(), sourceName: file.name, ...parsed.data, ...result }, null, 2),
        "utf8",
      );
      return Response.json({ id, ...result });
    } finally {
      await fs.rm(input, { force: true }); // the creator keeps the original; don't hold a second copy
    }
  } catch (e) {
    return errorResponse(e);
  }
}
