import { clearCache } from "@/lib/analysis";
import { clearTokens } from "@/lib/store";

export async function POST() {
  await clearTokens();
  clearCache();
  return Response.json({ ok: true });
}
