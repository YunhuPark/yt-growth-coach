import { getAutoJob } from "@/lib/editor/autoEditJobs";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const job = /^[0-9a-f]{16}$/.test(id) ? getAutoJob(id) : null;
  if (!job) return Response.json({ error: "분석 작업을 찾지 못했습니다. 서버가 다시 시작되었다면 처음부터 다시 해 주세요." }, { status: 404 });
  return Response.json(job);
}
