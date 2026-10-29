import { z } from "zod";
import { errorResponse } from "@/lib/shared/http";
import { makePreview } from "@/lib/editor/preview";
import { acceptSource, Rights, SourceError } from "@/lib/editor/source";

const Options = z.object({
  sourcePath: z.string().min(1).max(500),
  start: z.number().min(0).max(14400),
  end: z.number().min(0).max(14400),
  rights: Rights,
});

// A small low-resolution copy of one stretch of a video on this computer. (Uploaded files are previewed in the browser.)
export async function POST(req: Request) {
  try {
    const parsed = Options.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const noRights = parsed.error.issues.some((i) => i.path[0] === "rights");
      return Response.json({ error: noRights ? "영상 사용 권한 확인에 체크해야 미리 볼 수 있습니다." : "입력값을 확인해 주세요." }, { status: 400 });
    }
    let src;
    try {
      src = await acceptSource({ file: null, sourcePath: parsed.data.sourcePath, dir: "" });
    } catch (e) {
      if (e instanceof SourceError) return Response.json({ error: e.message }, { status: 400 });
      throw e;
    }
    return Response.json(await makePreview(src.input, parsed.data.start, parsed.data.end));
  } catch (e) {
    return errorResponse(e);
  }
}
