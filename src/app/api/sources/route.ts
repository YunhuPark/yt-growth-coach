import { z } from "zod";
import { getAnalysis } from "@/lib/analysis";
import { topHashtags } from "@/lib/discover";
import { errorResponse } from "@/lib/http";
import { findSources } from "@/lib/sources";
import { loadSettings } from "@/lib/store";

export const maxDuration = 120;

const Body = z.object({
  refresh: z.boolean().optional(),
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

// Each lookup costs ~400 YouTube quota units, so keep results for an hour per idea.
const g = globalThis as unknown as { __sources?: Map<string, { at: number; value: unknown }> };
const cache = (g.__sources ??= new Map());

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "아이디어 형식이 올바르지 않습니다." }, { status: 400 });
    const { idea, refresh } = parsed.data;
    const hit = cache.get(idea.title);
    if (!refresh && hit && Date.now() - hit.at < 60 * 60_000) return Response.json(hit.value);

    const a = await getAnalysis();
    const { regionCode } = await loadSettings();
    const value = await findSources(idea, topHashtags(a.videos).map((h) => h.tag), regionCode, a.channel.id);
    if (value.videos.length) cache.set(idea.title, { at: Date.now(), value }); // don't pin an empty result
    return Response.json(value);
  } catch (e) {
    return errorResponse(e);
  }
}
