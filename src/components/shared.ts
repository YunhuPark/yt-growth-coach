import type { LongPack, Pack } from "@/lib/package";

export const fmt = (n: number | undefined, d = 0) =>
  n === undefined || Number.isNaN(n) ? "–" : n.toLocaleString("ko-KR", { maximumFractionDigits: d });

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `요청 실패 (${res.status})`);
  return json as T;
}

/** Packages saved before long-form support have no `kind`; they are short packages. */
export const isLongPack = (p: Pack | LongPack): p is LongPack => "chapters" in p;

export type Basis = "own_footage" | "licensed" | "rights_holder_permission";

export const BASIS: { id: Basis; label: string }[] = [
  { id: "own_footage", label: "제가 직접 촬영한 영상" },
  { id: "licensed", label: "라이선스를 취득한 영상" },
  { id: "rights_holder_permission", label: "권리자에게 사용 허락을 받은 영상" },
];
