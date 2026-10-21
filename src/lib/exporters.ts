// Hand-off to other editors: subtitles as SRT (CapCut, Premiere, DaVinci and players read it), the cut list as an EDL
// (Premiere, DaVinci Resolve) and as plain text (to follow by hand, for example in CapCut). Pure functions, no server imports.

/** `kind` says what the text is in the video; plain dialogue captions are the default. */
export type Cue = { start: number; end: number; text: string; kind?: "hook" | "caption" | "ending" };
export type Cut = { start: number; end: number };

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, "0");

/** 83.4 -> "00:01:23,400" */
export function srtTime(sec: number): string {
  const ms = Math.round(Math.max(0, sec) * 1000);
  return `${pad(ms / 3_600_000)}:${pad((ms % 3_600_000) / 60_000)}:${pad((ms % 60_000) / 1000)},${pad(ms % 1000, 3)}`;
}

/** SubRip text. Cues are sorted, empty ones and ones that last no time are dropped, and a blank line inside a cue (which would end it) is removed. */
export function toSrt(cues: Cue[]): string {
  const clean = cues
    .map((c) => ({ ...c, text: c.text.replace(/\r/g, "").replace(/\n{2,}/g, "\n").trim() }))
    .filter((c) => c.text && Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
    .sort((a, b) => a.start - b.start);
  return clean.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
}

/** "0:01:23:15"-style timecode (HH:MM:SS:FF) at a whole-number frame rate. */
export function timecode(sec: number, fps: number): string {
  const frames = Math.round(Math.max(0, sec) * fps);
  const f = frames % fps;
  const s = Math.floor(frames / fps);
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}:${pad(f)}`;
}

/**
 * CMX 3600 EDL: one video and one audio event per kept range, placed back to back on the timeline. The frame rate has to be
 * the footage's (an EDL carries timecode, not seconds); non-drop only, so whole-number rates.
 */
export function toEdl(args: { title: string; fps: number; cuts: Cut[]; clipName: string }): string {
  const { fps, cuts } = args;
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) throw new Error("프레임 레이트는 24, 25, 30, 60 같은 정수여야 합니다.");
  const title = args.title.replace(/[\r\n]+/g, " ").trim() || "cut list";
  const clip = args.clipName.replace(/[\r\n]+/g, " ").trim() || "source";
  const lines = [`TITLE: ${title}`, "FCM: NON-DROP FRAME", ""];
  let at = 0;
  cuts.forEach((c, i) => {
    const len = c.end - c.start;
    if (!(len > 0)) return;
    const n = String(i + 1).padStart(3, "0");
    const rec = `${timecode(at, fps)} ${timecode(at + len, fps)}`;
    const src = `${timecode(c.start, fps)} ${timecode(c.end, fps)}`;
    lines.push(`${n}  AX       V     C        ${src} ${rec}`);
    lines.push(`${n}  AX       AA    C        ${src} ${rec}`);
    lines.push(`* FROM CLIP NAME: ${clip}`);
    lines.push("");
    at += len;
  });
  return lines.join("\n");
}

const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  return h ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
};

/** A cut list to follow by hand: where each piece comes from in the source and where it lands in the result. */
export function toCutList(args: { clipName: string; cuts: Cut[] }): string {
  let at = 0;
  const rows = args.cuts
    .filter((c) => c.end > c.start)
    .map((c, i) => {
      const len = c.end - c.start;
      const row = `${i + 1}) 원본 ${clock(c.start)} ~ ${clock(c.end)} (${Math.round(len)}초) → 결과 ${clock(at)} ~ ${clock(at + len)}`;
      at += len;
      return row;
    });
  return [`원본: ${args.clipName || "(파일)"}`, `조각 ${rows.length}개 · 결과 길이 ${clock(at)}`, "", ...rows, ""].join("\n");
}

/**
 * Everything that shows as text in an edited video, as subtitle cues on its own timeline: the hook, the captions, the ending
 * card, each tagged with what it is (so an export can leave the hook and ending out, which are titles rather than subtitles).
 */
export function planCues(plan: {
  hook?: { text: string; seconds: number } | null;
  captions: Cue[];
  ending?: { text: string; seconds: number } | null;
  outputSec: number;
}): Cue[] {
  const cues: Cue[] = [];
  if (plan.hook?.text.trim()) cues.push({ start: 0, end: Math.min(plan.hook.seconds, plan.outputSec), text: plan.hook.text, kind: "hook" });
  // Captions stop where the ending card begins, as they do in the render.
  const endFrom = plan.ending?.text.trim() ? Math.max(0, plan.outputSec - plan.ending.seconds) : plan.outputSec;
  for (const c of plan.captions) cues.push({ ...c, end: Math.min(c.end, endFrom), kind: "caption" });
  if (plan.ending?.text.trim()) cues.push({ start: endFrom, end: plan.outputSec, text: plan.ending.text, kind: "ending" });
  return cues;
}

/** A file name that is safe on Windows and macOS, with the extension. */
export function safeFileName(base: string, ext: string): string {
  const name = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "export";
  return `${name}.${ext}`;
}
