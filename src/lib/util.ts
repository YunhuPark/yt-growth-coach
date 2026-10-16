/** Run `fn` over `items` with at most `size` in flight, preserving order. */
export async function mapPool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Accepts a full YouTube URL (watch, shorts, youtu.be, embed) or a bare 11-char id. */
export function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = /(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([\w-]{11})/.exec(s);
  return m ? m[1] : null;
}
