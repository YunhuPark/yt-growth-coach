import { previewFile } from "@/lib/editor/preview";
import { serveVideo } from "@/lib/editor/serveVideo";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[a-f0-9]{16}$/.test(id)) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  return serveVideo(req, previewFile(id));
}
