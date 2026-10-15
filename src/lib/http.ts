import { GoogleApiError } from "./google";

/** Map thrown errors to JSON responses the UI can display. */
export function errorResponse(e: unknown) {
  if (e instanceof GoogleApiError) {
    const status = e.status === 401 ? 401 : 502;
    return Response.json({ error: e.message, needsAuth: e.status === 401 }, { status });
  }
  const message = e instanceof Error ? e.message : "알 수 없는 오류";
  return Response.json({ error: message }, { status: 500 });
}
