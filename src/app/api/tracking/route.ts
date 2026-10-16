import { z } from "zod";
import { getAnalysis } from "@/lib/analysis";
import { errorResponse } from "@/lib/http";
import { loadBaseline, loadRecommendation, loadTracking, saveTracking, type TrackEntry } from "@/lib/store";
import { evaluate, learnFromLevers, LEVERS, summarizeBaseline } from "@/lib/tracking";
import { mapPool, parseVideoId } from "@/lib/util";
import { videoDetails } from "@/lib/youtube";

export const maxDuration = 60;

export async function GET() {
  try {
    const [entries, baseline, a, rec] = await Promise.all([
      loadTracking(),
      loadBaseline(),
      getAnalysis(),
      loadRecommendation(),
    ]);
    const evaluated = await mapPool(entries, 3, (e) => evaluate(e, baseline));
    const tracked = new Set(entries.map((e) => e.videoId));
    const candidates = a.videos
      .filter((v) => !tracked.has(v.id) && v.ageDays <= 90)
      .sort((x, y) => y.publishedAt.localeCompare(x.publishedAt))
      .slice(0, 12)
      .map((v) => ({ id: v.id, title: v.title, publishedAt: v.publishedAt, format: v.format, views: v.views }));
    const ideas = ((rec?.result as { ideas?: { title: string }[] } | undefined)?.ideas ?? []).map((i) => i.title);
    return Response.json({
      baseline: baseline ? summarizeBaseline(baseline) : null,
      entries: evaluated,
      learned: learnFromLevers(evaluated),
      candidates,
      ideas,
      levers: LEVERS,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

const Body = z.object({
  video: z.string().min(1).max(300),
  ideaTitle: z.string().max(200).optional(),
  levers: z.array(z.string()).max(10),
  note: z.string().max(300).optional(),
});

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "입력 형식이 올바르지 않습니다." }, { status: 400 });
    const { video, ideaTitle, levers, note } = parsed.data;

    const id = parseVideoId(video);
    if (!id) return Response.json({ error: "유튜브 영상 주소나 ID를 확인해 주세요." }, { status: 400 });

    const a = await getAnalysis();
    const [d] = await videoDetails([id]);
    if (!d) return Response.json({ error: "영상을 찾지 못했습니다." }, { status: 404 });
    if (d.channelId !== a.channel.id) {
      return Response.json({ error: "내 채널의 영상만 추적할 수 있습니다." }, { status: 400 });
    }

    const valid = new Set<string>(LEVERS.map((l) => l.id));
    const entries = await loadTracking();
    const existing = entries.find((e) => e.videoId === id);
    const entry: TrackEntry = {
      ...existing, // keeps results already recorded by the collector
      videoId: id,
      title: d.title,
      publishedAt: d.publishedAt,
      format: d.format,
      ideaTitle,
      levers: levers.filter((l) => valid.has(l)),
      note,
      linkedAt: existing?.linkedAt ?? new Date().toISOString(),
    };
    await saveTracking([entry, ...entries.filter((e) => e.videoId !== id)]);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id가 필요합니다." }, { status: 400 });
  await saveTracking((await loadTracking()).filter((e) => e.videoId !== id));
  return Response.json({ ok: true });
}

const Patch = z.object({
  videoId: z.string().min(1).max(20),
  ideaTitle: z.string().max(200).optional(),
  levers: z.array(z.string()).max(10),
  note: z.string().max(300).optional(),
});

export async function PATCH(req: Request) {
  try {
    const parsed = Patch.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "입력 형식이 올바르지 않습니다." }, { status: 400 });
    const { videoId, ideaTitle, levers, note } = parsed.data;
    const valid = new Set<string>(LEVERS.map((l) => l.id));
    const entries = await loadTracking();
    if (!entries.some((e) => e.videoId === videoId)) {
      return Response.json({ error: "추적 중인 영상이 아닙니다." }, { status: 404 });
    }
    await saveTracking(
      entries.map((e) =>
        e.videoId === videoId
          ? { ...e, ideaTitle: ideaTitle || undefined, levers: levers.filter((l) => valid.has(l)), note: note || undefined, auto: false }
          : e,
      ),
    );
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
