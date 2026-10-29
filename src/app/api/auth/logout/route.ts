import { clearCache } from "@/lib/channel/analysis";
import { clearTokens } from "@/lib/shared/store";

export async function POST() {
  await clearTokens();
  clearCache();
  return Response.json({ ok: true });
}
