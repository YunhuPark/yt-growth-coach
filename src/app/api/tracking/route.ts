import { z } from "zod";
import { getAnalysis } from "@/lib/analysis";
import { errorResponse } from "@/lib/http";
import { loadBaseline, loadRecommendation, loadTracking, saveTracking, type TrackEntry } from "@/lib/store";
import { evaluate, learnFromLevers, LEVERS, summarizeBaseline } from "@/lib/tracking";
import { mapPool } from "@/lib/util";
import { videoDetails } from "@/lib/youtube";

export const maxDuration = 60;

/** Accepts a full YouTube URL (watch, shorts, youtu.be) or a bare 11-char id. */
function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = /(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([\w-]{11})/.exec(s);
  return m ? m[1] : null;
}

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
    const entry: TrackEntry = {
      videoId: id,
      title: d.title,
      publishedAt: d.publishedAt,
      format: d.format,
      ideaTitle,
      levers: levers.filter((l) => valid.has(l)),
      note,
      linkedAt: new Date().toISOString(),
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
