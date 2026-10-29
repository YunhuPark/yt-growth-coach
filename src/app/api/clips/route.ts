import { z } from "zod";
import { getAnalysis } from "@/lib/channel/analysis";
import { deleteClip, LinkError, linkClip, registerClip } from "@/lib/channel/clips";
import { validateClips } from "@/lib/channel/clipValidation";
import { errorResponse } from "@/lib/shared/http";
import { loadClips } from "@/lib/shared/store";

const Register = z.object({
  id: z.string().regex(/^[a-f0-9]{16}$/),
  sourceName: z.string().max(300).default(""),
  aiScore: z.number().min(1).max(10),
  reason: z.string().max(400).default(""),
  title: z.string().max(200).default(""),
  hook: z.string().max(200).default(""),
  start: z.number().min(0),
  end: z.number().min(0),
  lengthFit: z.enum(["within", "shorter", "longer"]).nullable().optional(),
});

const Link = z.object({ id: z.string().regex(/^[a-f0-9]{16}$/), video: z.string().max(300).nullable() });

/** Clips made from AI candidates, my recent Shorts to link them to, and how well the AI scores matched real results. */
export async function GET() {
  try {
    const clips = await loadClips();
    let videos: { id: string; title: string; publishedAt: string; score: number | null; viewsPerDay: number }[] = [];
    let videosError: string | null = null;
    try {
      const a = await getAnalysis();
      videos = a.videos
        .filter((v) => v.format === "short")
        .map((v) => ({ id: v.id, title: v.title, publishedAt: v.publishedAt, score: v.score, viewsPerDay: v.viewsPerDay }));
    } catch (e) {
      videosError = e instanceof Error ? e.message : "채널 영상을 불러오지 못했습니다.";
    }
    return Response.json({ clips, videos, videosError, validation: validateClips(clips, videos) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const parsed = Register.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "입력값을 확인해 주세요." }, { status: 400 });
    return Response.json(await registerClip({ ...parsed.data, lengthFit: parsed.data.lengthFit ?? null }));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const parsed = Link.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "입력값을 확인해 주세요." }, { status: 400 });
    return Response.json(await linkClip(parsed.data.id, parsed.data.video));
  } catch (e) {
    if (e instanceof LinkError) return Response.json({ error: e.message }, { status: 400 });
    return errorResponse(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!/^[a-f0-9]{16}$/.test(id)) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
    await deleteClip(id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
