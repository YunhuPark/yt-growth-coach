// Captions as typed into a card (strings), turned into what the renderer takes. Kept apart from the component so it can be tested.

export type Cap = { start: string; end: string; text: string };

/** Blank text is dropped; times must be numbers with the end after the start and the start not negative. */
export function editedCaptions(caps: Cap[]): { start: number; end: number; text: string }[] {
  return caps
    .map((c) => ({ start: Number(c.start), end: Number(c.end), text: c.text.trim() }))
    .filter((c) => c.text && Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start && c.start >= 0);
}

/** A line with text but unusable times: shown in red so it isn't silently left out of the video. */
export const captionHasBadTimes = (c: Cap) => c.text.trim() !== "" && !(Number(c.end) > Number(c.start) && Number(c.start) >= 0);

export const toCaps = (captions: { start: number; end: number; text: string }[]): Cap[] =>
  captions.map((c) => ({ start: String(c.start), end: String(c.end), text: c.text }));
