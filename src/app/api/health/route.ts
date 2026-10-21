import { errorResponse } from "@/lib/http";
import { checkHealth } from "@/lib/health";

export async function GET() {
  try {
    return Response.json(await checkHealth());
  } catch (e) {
    return errorResponse(e);
  }
}
