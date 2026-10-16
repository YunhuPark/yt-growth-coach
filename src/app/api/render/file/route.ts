import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

/** Streams a finished render, with Range support so the <video> element can seek. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  if (!/^[a-f0-9]{16}$/.test(id)) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });

  const file = path.join(process.cwd(), ".data", "renders", id, "output.mp4");
  let size: number;
  try {
    size = (await fs.stat(file)).size;
  } catch {
    return Response.json({ error: "파일을 찾지 못했습니다." }, { status: 404 });
  }

  const headers: Record<string, string> = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes" };
  if (url.searchParams.has("download")) headers["Content-Disposition"] = `attachment; filename="video-${id}.mp4"`;

  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: { ...headers, "Content-Length": String(size) },
  });
}
