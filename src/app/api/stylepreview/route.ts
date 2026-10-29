import { promises as fs } from "node:fs";
import { errorResponse } from "@/lib/shared/http";
import { makeStylePreview } from "@/lib/editor/stylePreview";

// One picture of how a caption style looks: GET /api/stylepreview?layout=short&preset=outline&position=bottom&scale=1
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const layout = q.get("layout") === "long" ? "long" : "short";
    const file = await makeStylePreview(layout, {
      preset: (q.get("preset") ?? undefined) as never,
      position: (q.get("position") ?? undefined) as never,
      scale: Number(q.get("scale") ?? 1),
    });
    return new Response(new Uint8Array(await fs.readFile(file)), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
