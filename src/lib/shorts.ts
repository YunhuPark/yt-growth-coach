import { loadShortsCache, saveShortsCache } from "./store";
import { mapPool, sleep } from "./util";

/** YouTube Shorts can be up to 3 minutes since Oct 2024 (60 s before). Anything longer is never a Short. */
export const SHORT_MAX_SEC = 180;

/**
 * Asks YouTube whether a video is really a Short.
 *
 * `youtube.com/shorts/<id>` opens as-is for a Short and redirects to the normal `/watch` page for anything else.
 * That is not an official API, so the answer is trusted only when it is unambiguous:
 *   true  - the Shorts page opened (200)
 *   false - redirected to /watch
 *   null  - anything else (rate limit, consent/bot-check redirect, network error, ...): "don't know"
 */
export async function checkShort(id: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${encodeURIComponent(id)}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel(); // only the status matters; don't download the page
    if (res.status === 200) return true;
    if (res.status >= 300 && res.status < 400) return /\/watch\?/.test(res.headers.get("location") ?? "") ? false : null;
    return null;
  } catch {
    return null;
  }
}

export type FormatCheck = {
  /** the duration rule and YouTube agreed */
  confirmed: number;
  /** 3 minutes or less, but YouTube says it is not a Short, so it became long-form */
  reclassified: number;
  /** couldn't be checked; the duration rule was kept */
  unknown: number;
};

type Formattable = { id: string; durationSec: number; format: "short" | "long" };

/** Stop asking after this many failures in a row, so a block or outage doesn't turn into hammering. */
const MAX_CONSECUTIVE_FAILURES = 5;

export type RefineOptions = {
  /**
   * How many videos to ask about per call. YouTube stops answering when it is asked too fast, so a big channel is
   * checked over several calls; saved answers carry over and the rest keep the duration rule until then.
   */
  maxChecks?: number;
  /** Pause between requests, in ms. Requests are sent one at a time. */
  gapMs?: number;
};

/**
 * Corrects `format` using YouTube's own answer. Only videos of 3 minutes or less are checked, answers are saved
 * (a video never changes from Short to not-Short), and anything unanswered keeps the duration rule.
 */
export async function refineFormats(videos: Formattable[], opts: RefineOptions = {}): Promise<FormatCheck> {
  const { maxChecks = 60, gapMs = 400 } = opts;
  const cache = await loadShortsCache();
  const need = videos.filter((v) => v.durationSec <= SHORT_MAX_SEC && cache[v.id] === undefined).slice(0, maxChecks);

  if (need.length) {
    let failures = 0;
    let halted = false;
    await mapPool(need, 1, async (v) => {
      if (halted) return;
      const answer = await checkShort(v.id);
      if (answer === null) {
        if (++failures >= MAX_CONSECUTIVE_FAILURES) halted = true;
      } else {
        failures = 0;
        cache[v.id] = answer;
      }
      await sleep(gapMs); // be gentle
    });
    await saveShortsCache(cache);
  }

  const out: FormatCheck = { confirmed: 0, reclassified: 0, unknown: 0 };
  for (const v of videos) {
    if (v.durationSec > SHORT_MAX_SEC) {
      v.format = "long";
      continue;
    }
    const known = cache[v.id];
    if (known === undefined) {
      out.unknown++;
      continue;
    }
    const next = known ? "short" : "long";
    if (next === v.format) out.confirmed++;
    else out.reclassified++;
    v.format = next;
  }
  return out;
}

/** The note shown above the dashboard when the check changed or couldn't settle anything. */
export function formatCheckNotes(c: FormatCheck): string[] {
  const notes: string[] = [];
  if (c.reclassified) notes.push(`${c.reclassified}개 영상은 3분 이하지만 YouTube가 쇼츠로 취급하지 않아 롱폼으로 분류했습니다.`);
  if (c.unknown) notes.push(`${c.unknown}개 영상은 쇼츠 여부를 아직 확인하지 못해 길이(3분 이하) 기준으로 분류했습니다. 데이터를 새로고침하면 이어서 확인합니다.`);
  return notes;
}
