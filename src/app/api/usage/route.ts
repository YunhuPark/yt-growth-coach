import { z } from "zod";
import { errorResponse } from "@/lib/shared/http";
import { loadPricing, loadUsage, savePricing } from "@/lib/shared/store";
import { flushUsage, recordCostUsd, summarizeUsage } from "@/lib/shared/usage";

const Pricing = z.object({
  inputPerMTok: z.number().min(0).max(10_000).optional(),
  outputPerMTok: z.number().min(0).max(10_000).optional(),
  usdToKrw: z.number().min(1).max(100_000).optional(),
});

/** What each kind of work costs and how long it takes, from the runs measured so far, at the prices entered. */
export async function GET() {
  try {
    await flushUsage();
    const [records, pricing] = await Promise.all([loadUsage(), loadPricing()]);
    return Response.json({
      pricing,
      summary: summarizeUsage(records, pricing),
      recent: records
        .slice(-60)
        .reverse()
        .map((r) => ({
          id: r.id,
          at: r.at,
          kind: r.kind,
          ok: r.ok,
          wallMs: r.wallMs,
          inputTokens: r.calls.reduce((n, c) => n + c.inputTokens, 0),
          outputTokens: r.calls.reduce((n, c) => n + c.outputTokens, 0),
          calls: r.calls.length,
          costUsd: recordCostUsd(r, pricing),
          stages: r.stages,
          meta: r.meta,
        })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request) {
  try {
    const parsed = Pricing.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "단가는 0 이상의 숫자로 입력해 주세요." }, { status: 400 });
    await savePricing(parsed.data);
    return Response.json(parsed.data);
  } catch (e) {
    return errorResponse(e);
  }
}
