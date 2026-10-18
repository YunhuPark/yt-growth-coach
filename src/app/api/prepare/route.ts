import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { currentPrepare, startPrepare } from "@/lib/prepare";
import { nextDue } from "@/lib/schedule";
import { loadPrep, loadSettings } from "@/lib/store";

export const maxDuration = 60;

/** Progress of the run in flight (if any), the last finished run, and the weekly schedule. */
export async function GET() {
  try {
    const [last, settings] = await Promise.all([loadPrep(), loadSettings()]);
    const w = settings.weekly;
    return Response.json({
      live: currentPrepare(),
      last,
      weekly: { enabled: w.enabled, day: w.day, hour: w.hour },
      nextRun: w.enabled ? nextDue(new Date(), w.day, w.hour).toISOString() : null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

const Body = z.object({
  goal: z.string().max(200).optional(),
  packages: z.number().int().min(1).max(3).optional(),
  sources: z.boolean().optional(),
});

/** Starts a preparation in the background (the page polls GET for progress). */
export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "입력 형식이 올바르지 않습니다." }, { status: 400 });
    const { started, live } = startPrepare({ trigger: "manual", ...parsed.data });
    return Response.json({ started, live }, { status: started ? 202 : 200 });
  } catch (e) {
    return errorResponse(e);
  }
}
