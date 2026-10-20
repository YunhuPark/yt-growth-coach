// Chapters for a long-form video: cleaned up from the model's proposal, formatted the way YouTube reads them from a
// description, and turned into title cards for the render. No SDK imports, so client components can use it too.

export type Chapter = { time: number; title: string };
export type SourceChapter = { start: number; title: string };

/** YouTube turns the description's timestamps into chapters only with at least 3 of them, the first at 0:00, 10 s+ apart. */
export const MIN_CHAPTERS = 3;
export const MIN_CHAPTER_GAP = 10;

/** 75 -> "1:15", 3725 -> "1:02:05" */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
}

const cleanTitle = (t: string) => t.replace(/\[[^\]]*\]/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);

/**
 * Maps the model's source-time chapters onto the edited video. A chapter that falls in a cut part moves to the start of the
 * next kept part. The list always starts at 0:00 (YouTube requires it); chapters closer than 10 s to the previous one are
 * dropped. Fewer than 3 left means YouTube would ignore them all, so the result is empty.
 */
export function mapChapters(raw: SourceChapter[], kept: { start: number; end: number }[]): Chapter[] {
  if (!kept.length) return [];
  const offsets: number[] = [];
  let acc = 0;
  for (const k of kept) {
    offsets.push(acc);
    acc += k.end - k.start;
  }
  const total = acc;

  const mapped: Chapter[] = [];
  for (const c of raw) {
    const title = cleanTitle(c.title);
    if (!title || !Number.isFinite(c.start)) continue;
    const i = kept.findIndex((k) => c.start < k.end);
    if (i < 0) continue; // after everything that was kept
    const time = offsets[i] + Math.max(0, c.start - kept[i].start);
    mapped.push({ time: Math.round(time * 10) / 10, title });
  }
  mapped.sort((a, b) => a.time - b.time);

  const out: Chapter[] = [];
  for (const c of mapped) {
    const last = out[out.length - 1];
    if (last && c.time - last.time < MIN_CHAPTER_GAP) continue;
    if (c.time >= total - 1) continue; // a chapter that starts at the very end has nothing in it
    out.push(c);
  }
  // The list must start at 0:00. A first chapter that begins within 10 s of the start is simply moved there; otherwise the
  // opening gets its own chapter instead of its content being mislabelled with the first chapter's title.
  if (out.length) {
    if (out[0].time <= MIN_CHAPTER_GAP) out[0] = { ...out[0], time: 0 };
    else out.unshift({ time: 0, title: "오프닝" });
  }
  return out.length >= MIN_CHAPTERS ? out : [];
}

/** "0:00 오프닝" lines, one chapter per line, as YouTube expects them in the description. */
export const chapterLines = (chapters: Chapter[]) => chapters.map((c) => `${formatClock(c.time)} ${c.title}`).join("\n");

/**
 * Title cards for the render: each chapter after the first shows its title for a few seconds from its start. A caption
 * that would overlap a card is dropped, because both use the same place on screen.
 */
export function withChapterCards<C extends { start: number; end: number; text: string }>(
  captions: C[],
  chapters: Chapter[],
  seconds = 4,
): { start: number; end: number; text: string }[] {
  const cards = chapters.slice(1).map((c, i) => {
    const next = chapters[i + 2]?.time ?? Infinity;
    return { start: c.time, end: Math.min(c.time + seconds, next), text: c.title };
  });
  const free = captions.filter((c) => !cards.some((k) => c.start < k.end && k.start < c.end));
  return [...free, ...cards].sort((a, b) => a.start - b.start);
}
