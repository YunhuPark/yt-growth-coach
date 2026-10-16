import { getJob } from "@/lib/renderJobs";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[a-f0-9]{16}$/.test(id)) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  const job = await getJob(id);
  if (!job) return Response.json({ error: "작업을 찾지 못했습니다. 서버가 다시 시작됐을 수 있습니다." }, { status: 404 });
  return Response.json(job);
}
