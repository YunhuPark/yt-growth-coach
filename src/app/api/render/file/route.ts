import path from "node:path";
import { serveVideo } from "@/lib/editor/serveVideo";

/** Streams a finished render, with Range support so the <video> element can seek. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  if (!/^[a-f0-9]{16}$/.test(id)) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });

  const file = path.join(process.cwd(), ".data", "renders", id, "output.mp4");
  return serveVideo(req, file, url.searchParams.has("download") ? `video-${id}.mp4` : undefined);
}
