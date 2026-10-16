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
