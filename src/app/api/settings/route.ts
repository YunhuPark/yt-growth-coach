import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { loadSettings, saveSettings } from "@/lib/store";

const Body = z.object({
  regionCode: z.string().length(2).toUpperCase(),
  categoryId: z.string().regex(/^\d*$/),
  competitors: z.array(z.string().trim().min(1).max(60)).max(8),
  keywords: z.array(z.string().trim().min(1).max(60)).max(5),
});

export async function GET() {
  return Response.json(await loadSettings());
}

export async function PUT(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "설정 형식이 올바르지 않습니다." }, { status: 400 });
    await saveSettings(parsed.data);
    return Response.json(parsed.data);
  } catch (e) {
    return errorResponse(e);
  }
}
