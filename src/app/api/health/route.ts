import { errorResponse } from "@/lib/shared/http";
import { checkHealth } from "@/lib/editor/health";

export async function GET() {
  try {
    return Response.json(await checkHealth());
  } catch (e) {
    return errorResponse(e);
  }
}
