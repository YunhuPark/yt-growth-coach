import { randomBytes } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { autoEditDir, startAutoEdit } from "@/lib/editor/autoEditJobs";
import { errorResponse } from "@/lib/shared/http";
import { acceptSource, Rights, SourceError } from "@/lib/editor/source";

const Options = z.object({
  layout: z.enum(["short", "long"]).default("short"),
  topic: z.string().max(300).default(""),
  targetSec: z.number().min(5).max(14400),
  speech: z.boolean().default(false),
  sourcePath: z.string().max(500).optional(),
  rights: Rights,
});

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
      return Response.json(
        { error: noRights ? "영상 사용 권한 확인에 체크해야 분석할 수 있습니다." : "입력값을 확인해 주세요." },
        { status: 400 },
      );
    }
    const { sourcePath, layout, topic, targetSec, speech } = parsed.data;
    const id = randomBytes(8).toString("hex");
    const dir = path.join(autoEditDir(), id);

    let src;
    try {
      src = await acceptSource({ file: form.get("file"), sourcePath, dir });
    } catch (e) {
      if (e instanceof SourceError) return Response.json({ error: e.message }, { status: 400 });
      throw e;
    }

    startAutoEdit({ id, dir, input: src.input, ctx: { layout, topic, targetSec }, deleteInput: src.deleteInput, speech: speech ? {} : undefined });
    return Response.json({ id }, { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}
