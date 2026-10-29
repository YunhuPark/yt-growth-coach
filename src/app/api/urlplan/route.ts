import { z } from "zod";
import { loadClipProfile } from "@/lib/channel/channelProfile";
import { errorResponse } from "@/lib/shared/http";
import { addMeta, timed, tracked } from "@/lib/shared/usage";
import { fetchFrames, fetchSignals, planFromSignals, UrlPlanError } from "@/lib/editor/urlPlan";

const Options = z.object({
  url: z.string().min(1).max(300),
  topic: z.string().max(300).default(""),
  count: z.number().int().min(1).max(6).default(5),
});

// Analyses a YouTube address without downloading anything: the video's public comments, chapters and text, plus the preview pictures YouTube serves.
export async function POST(req: Request) {
  try {
    const parsed = Options.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "입력값을 확인해 주세요." }, { status: 400 });
    const { url, topic, count } = parsed.data;

    try {
      const plan = await tracked("urlplan", async () => {
        const signals = await timed("YouTube 읽기", () => fetchSignals(url));
        // Not signed in or no history: plan without the channel's own results.
        const [profile, frames] = await timed("채널·이미지", () => Promise.all([loadClipProfile().catch(() => null), fetchFrames(signals.video.id)]));
        addMeta({ videoSec: signals.video.durationSec, frames: frames.length, comments: signals.moments.length });
        return planFromSignals(signals, { topic, count, profile }, undefined, frames);
      });
      return Response.json(plan);
    } catch (e) {
      if (e instanceof UrlPlanError) return Response.json({ error: e.message }, { status: 400 });
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
