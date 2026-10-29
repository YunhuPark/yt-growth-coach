import { z } from "zod";
import { collectOnce } from "@/lib/channel/collector";
import { errorResponse } from "@/lib/shared/http";
import { loadCollector, loadEvents, saveEvents } from "@/lib/shared/store";

export const maxDuration = 300;

async function status() {
  const [state, events] = await Promise.all([loadCollector(), loadEvents()]);
  return {
    lastRunAt: state.lastRunAt ?? null,
    lastError: state.lastError ?? null,
    lastResult: state.lastResult ?? null,
    autoOn: process.env.AUTO_COLLECT !== "off",
    unread: events.filter((e) => !e.read).length,
    events: events.slice(0, 30),
  };
}

export async function GET() {
  try {
    return Response.json(await status());
  } catch (e) {
    return errorResponse(e);
  }
}

const Body = z.object({ action: z.enum(["run", "read"]) });

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });

    if (parsed.data.action === "run") {
      const result = await collectOnce();
      if (result.error) return Response.json({ error: result.error }, { status: 502 });
      return Response.json({ result, ...(await status()) });
    }
    await saveEvents((await loadEvents()).map((e) => ({ ...e, read: true })));
    return Response.json(await status());
  } catch (e) {
    return errorResponse(e);
  }
}
