import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { loadSettings, saveSettings } from "@/lib/store";

const Body = z.object({
  regionCode: z.string().length(2).toUpperCase(),
  categoryId: z.string().regex(/^\d*$/),
  competitors: z.array(z.string().trim().min(1).max(60)).max(8),
  keywords: z.array(z.string().trim().min(1).max(60)).max(5),
  // Optional so the screens that only edit trend settings don't have to send it (and can't wipe it).
  weekly: z
    .object({ enabled: z.boolean(), day: z.number().int().min(0).max(6), hour: z.number().int().min(0).max(23) })
    .optional(),
});

export async function GET() {
  return Response.json(await loadSettings());
}

export async function PUT(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "설정 형식이 올바르지 않습니다." }, { status: 400 });

    const current = await loadSettings();
    let weekly = current.weekly;
    if (parsed.data.weekly) {
      const w = parsed.data.weekly;
      // Switching it on, or moving it to another slot, restarts the wait: the first run happens at the next
      // scheduled moment rather than immediately.
      const rescheduled = w.enabled !== current.weekly.enabled || w.day !== current.weekly.day || w.hour !== current.weekly.hour;
      weekly = { ...w, since: rescheduled || !current.weekly.since ? new Date().toISOString() : current.weekly.since };
    }

    const next = { ...parsed.data, weekly };
    await saveSettings(next);
    return Response.json(next);
  } catch (e) {
    return errorResponse(e);
  }
}
