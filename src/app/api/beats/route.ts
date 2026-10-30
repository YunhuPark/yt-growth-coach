import { randomBytes } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { autoEditDir, startBeats } from "@/lib/editor/autoEditJobs";
import { errorResponse } from "@/lib/shared/http";
import { acceptSource, Rights, SourceError } from "@/lib/editor/source";

const Options = z.object({
  startSec: z.number().min(0).max(14400).optional(),
  lengthSec: z.number().min(4).max(600).optional(),
  sourcePath: z.string().max(500).optional(),
  rights: Rights,
});

// Starts the search for the beats of the music in a video. Poll /api/autoedit/status?id=... for it.
export async function POST(req: Request) {
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
      return Response.json({ error: noRights ? "영상 사용 권한 확인에 체크해야 분석할 수 있습니다." : "입력값을 확인해 주세요." }, { status: 400 });
    }
    const { sourcePath, startSec, lengthSec } = parsed.data;
    const id = randomBytes(8).toString("hex");
    const dir = path.join(autoEditDir(), id);

    let src;
    try {
      src = await acceptSource({ file: form.get("file"), sourcePath, dir });
    } catch (e) {
      if (e instanceof SourceError) return Response.json({ error: e.message }, { status: 400 });
      throw e;
    }

    startBeats({ id, dir, input: src.input, deleteInput: src.deleteInput, startSec, lengthSec });
    return Response.json({ id }, { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}
