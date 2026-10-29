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

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Text with half-characters replaced. A cut through the middle of an emoji (or a comment that already holds one) leaves a lone
 * surrogate, and a request body containing it is rejected as invalid JSON by the API it is sent to.
 */
export const wellFormed = (s: string) => s.replace(LONE_SURROGATE, "�");

/** `s.slice(0, max)` that never ends in the first half of an emoji. */
export function safeSlice(s: string, max: number): string {
  const cut = s.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** Accepts a full YouTube URL (watch, shorts, youtu.be, embed) or a bare 11-char id. */
export function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = /(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([\w-]{11})/.exec(s);
  return m ? m[1] : null;
}
