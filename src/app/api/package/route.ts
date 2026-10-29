import { z } from "zod";
import { errorResponse } from "@/lib/shared/http";
import { generatePackage } from "@/lib/channel/flows";
import { IdeaSchema } from "@/lib/channel/recommend";
import { loadPackages } from "@/lib/shared/store";

export const maxDuration = 120;

export async function GET() {
  return Response.json(await loadPackages());
}

export async function POST(req: Request) {
  try {
    const parsed = z.object({ idea: IdeaSchema }).safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "아이디어 형식이 올바르지 않습니다." }, { status: 400 });
    return Response.json(await generatePackage(parsed.data.idea));
  } catch (e) {
    return errorResponse(e);
  }
}
