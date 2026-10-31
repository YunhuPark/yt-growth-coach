import { promises as fs } from "node:fs";
import { analyzeBeats, MAX_ANALYSIS_SEC, type BeatAnalysis } from "./beatAnalysis";
import { beatsInResult, beatTrust, everyNth } from "./beats";
import { usedRanges } from "./autoReframe";
import { normalizeEffects } from "./effects";
import { probe, type RenderOpts } from "./render";

// Beat-synced effects inside a render: before the video is made, listen to the music in the parts that will be used and turn the
// transition and sound of the effects into ones on the beats (the same as the beat tool, but for any video the page makes).

/** Nothing watches an unattended render, so only beats that are both even and on real onsets are used; the rest is left to the cuts. */
const MIN_BEATS = 8;

export type BeatEffectsResult = { opts: RenderOpts; /** how many beats got an effect; null when beats were not asked for */ beats: number | null; note?: string };

/**
 * Puts `effects.beatTimes` into the options when they ask for effects on the beats. When the music cannot be heard well enough
 * (no sound, no steady beat) the effects stay on the cuts and `note` says so.
 */
export async function withBeatEffects(
  input: string,
  dir: string,
  opts: RenderOpts,
  args: { analyze?: (input: string, dir: string, o: { startSec: number; lengthSec: number }) => Promise<BeatAnalysis>; onStage?: (s: string) => void } = {},
): Promise<BeatEffectsResult> {
  const fx = normalizeEffects(opts.effects);
  if (!fx.onBeats || (fx.transition === "none" && fx.cutSound === "none")) return { opts, beats: null };
  const cuts = (why: string): BeatEffectsResult => ({ opts: { ...opts, effects: { ...opts.effects, onBeats: false } }, beats: 0, note: `${why} 박자 대신 컷에 넣었습니다.` });

  await fs.mkdir(dir, { recursive: true });
  const info = await probe(input, dir);
  const pieces = usedRanges(opts, info.duration).filter((p) => p.end > p.start);
  if (!pieces.length) return { opts, beats: null };
  args.onStage?.("음악의 박자 찾는 중");
  const startSec = pieces[0].start;
  const wanted = pieces[pieces.length - 1].end - startSec;
  let found: BeatAnalysis;
  try {
    found = await (args.analyze ?? analyzeBeats)(input, dir, { startSec, lengthSec: Math.min(wanted, MAX_ANALYSIS_SEC) });
  } catch (e) {
    return cuts(`박자를 찾지 못했습니다(${e instanceof Error ? e.message.replace(/\.$/, "") : "분석 실패"}).`);
  }
  if (found.beats.length < MIN_BEATS || beatTrust(found.regularity, found.support) !== "high") return cuts("음악의 박자가 뚜렷하지 않습니다.");

  const heard = pieces.filter((p) => p.start < found.fromSec + found.analyzedSec);
  const beatTimes = everyNth(beatsInResult(heard, found.beats), fx.beatEvery);
  const partial = wanted > MAX_ANALYSIS_SEC ? ` 앞쪽 ${Math.round(MAX_ANALYSIS_SEC / 60)}분까지만 박자를 찾아 그 뒤에는 효과가 없습니다.` : "";
  return { opts: { ...opts, effects: { ...opts.effects, beatTimes } }, beats: beatTimes.length, note: `${Math.round(found.bpm)} BPM으로 박자를 찾아 ${beatTimes.length}곳에 넣었습니다.${partial}` };
}
