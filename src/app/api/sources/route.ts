import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { lookupSources } from "@/lib/flows";
import { IdeaSchema } from "@/lib/recommend";

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const parsed = z.object({ refresh: z.boolean().optional(), idea: IdeaSchema }).safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "아이디어 형식이 올바르지 않습니다." }, { status: 400 });
    return Response.json(await lookupSources(parsed.data.idea, parsed.data.refresh));
  } catch (e) {
    return errorResponse(e);
  }
}
