import { z } from "zod";
import { getAnalysis } from "@/lib/analysis";
import { errorResponse } from "@/lib/http";
import { makeAnyPackage } from "@/lib/package";
import { loadPackages, loadRecommendation, savePackages } from "@/lib/store";

export const maxDuration = 120;

const Body = z.object({
  idea: z.object({
    format: z.enum(["long", "short", "reels"]),
    title: z.string(),
    hook: z.string(),
    outline: z.array(z.string()),
    cta: z.string(),
    why: z.string(),
    basedOn: z.enum(["my_channel", "trend", "competitor", "mixed"]),
    confidence: z.enum(["high", "medium", "low"]),
  }),
});

export async function GET() {
  return Response.json(await loadPackages());
}

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "아이디어 형식이 올바르지 않습니다." }, { status: 400 });
    const { idea } = parsed.data;

    const a = await getAnalysis();
    const rec = (await loadRecommendation())?.result as
      | { actions?: { kind: string; title: string; how: string }[] }
      | undefined;
    const actions = (rec?.actions ?? []).slice(0, 7).map((x) => `[${x.kind}] ${x.title} — ${x.how}`);

    const pack = await makeAnyPackage({
      idea,
      channelTitle: a.channel.title,
      scored: a.videos,
      patterns: a.patterns,
      actions,
    });
    const all = await loadPackages();
    all[idea.title] = { at: new Date().toISOString(), idea, pack };
    await savePackages(all);
    return Response.json(all[idea.title]);
  } catch (e) {
    return errorResponse(e);
  }
}
