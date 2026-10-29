import { promises as fs } from "node:fs";
import { captionsFor, MAX_CLIP, type Highlight } from "./highlights";
import { probe } from "./render";
import { transcribeVideo, type Transcriber } from "./transcribe";
import { timed } from "../shared/usage";

export type RangeInfo = {
  /** length of the file the creator supplied, for comparing with the original video */
  fileDurationSec: number;
  hasAudio: boolean;
  /** the range as used: clamped to the file */
  start: number;
  end: number;
  /** dialogue captions on the clip's own timeline (0 = start of the range); empty without speech recognition */
  captions: Highlight["captions"];
};

/**
 * Looks at one stretch of a file the creator supplied: how long the file is and, if asked, what is said in that stretch.
 * Used to turn an edit brief (a range from a URL plan) into a Short without analysing the whole video.
 */
export async function rangeCaptions(args: {
  input: string;
  /** scratch folder; created if missing */
  dir: string;
  start: number;
  end: number;
  speech: boolean;
  transcriber?: Transcriber;
  onStage?: (s: string) => void;
}): Promise<RangeInfo> {
  if (!(Number.isFinite(args.start) && Number.isFinite(args.end)) || args.start < 0 || args.end <= args.start) {
    throw new Error("구간의 시작과 끝을 확인해 주세요.");
  }
  if (args.end - args.start > MAX_CLIP) throw new Error(`구간은 ${MAX_CLIP}초까지만 쓸 수 있습니다.`);
  await fs.mkdir(args.dir, { recursive: true });

  const info = await probe(args.input, args.dir);
  if (args.start >= info.duration) throw new Error("구간의 시작이 파일 길이를 넘었습니다. 올바른 영상 파일인지 확인해 주세요.");
  const end = Math.min(args.end, info.duration);

  let captions: Highlight["captions"] = [];
  if (args.speech && info.hasAudio) {
    const t = await timed("음성 인식", () =>
      transcribeVideo(args.input, args.dir, {
        duration: end - args.start,
        silences: [], // one stretch: the range is short and was picked for having something in it
        startSec: args.start,
        transcriber: args.transcriber,
        onStage: args.onStage,
      }),
    );
    captions = captionsFor(0, end - args.start, t.segments);
  }
  return { fileDurationSec: info.duration, hasAudio: info.hasAudio, start: args.start, end, captions };
}

export { lengthMismatch, MISMATCH_LIMIT } from "./mismatch";
