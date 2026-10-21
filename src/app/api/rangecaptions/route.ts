import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { autoEditDir } from "@/lib/autoEditJobs";
import { errorResponse } from "@/lib/http";
import { rangeCaptions } from "@/lib/rangeCaptions";
import { tracked } from "@/lib/usage";
import { acceptSource, Rights, SourceError } from "@/lib/source";

const Options = z.object({
  start: z.number().min(0).max(14400),
  end: z.number().min(0).max(14400),
  speech: z.boolean().default(false),
  sourcePath: z.string().max(500).optional(),
  rights: Rights,
});

// Checks a file against an edit brief (is it as long as the original video?) and, if asked, writes out the dialogue in the
// brief's range as captions. Synchronous: one short range, plus a model download the first time speech is used.
export async function POST(req: Request) {
  const dir = path.join(autoEditDir(), randomBytes(8).toString("hex"));
  let upload: string | null = null;
  try {
    const form = await req.formData();
    let raw: unknown;
    try {
      raw = JSON.parse(String(form.get("options") ?? "{}"));
    } catch {
      return Response.json({ error: "옵션 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const parsed = Options.safeParse(raw);
    if (!parsed.success) {
      const noRights = parsed.error.issues.some((i) => i.path[0] === "rights");
      return Response.json({ error: noRights ? "영상 사용 권한 확인에 체크해야 합니다." : "입력값을 확인해 주세요." }, { status: 400 });
    }
    const { sourcePath, start, end, speech } = parsed.data;

    let src;
    try {
      src = await acceptSource({ file: form.get("file"), sourcePath, dir });
    } catch (e) {
      if (e instanceof SourceError) return Response.json({ error: e.message }, { status: 400 });
      throw e;
    }
    if (src.deleteInput) upload = src.input;

    return Response.json(await tracked("rangecaptions", () => rangeCaptions({ input: src.input, dir, start, end, speech }), { speech, rangeSec: Math.round(end - start) }));
  } catch (e) {
    return errorResponse(e);
  } finally {
    if (upload) await fs.rm(upload, { force: true });
    await fs.rm(dir, { recursive: true, force: true });
  }
}
