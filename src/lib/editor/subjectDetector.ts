import path from "node:path";
import { isSubjectLabel, type Box } from "./reframe";
import { modelsDir } from "./transcribe";

// Finds people (and animals and vehicles) in a picture, on this computer: a small object-detection model (YOLOS tiny, quantized,
// about 9 MB, trained on the 80 COCO classes) run through transformers.js. The model is downloaded once, on first use, into .data/models. The pictures never leave the machine.

export const DETECTOR_MODEL = "Xenova/yolos-tiny";
export const DETECTOR_MODEL_SIZE_MB = 9;

export type { Box };
export type Detector = (imagePath: string) => Promise<Box[]>;

/**
 * The model looks at the picture scaled to this size. Its default (512 on the short side) takes about 2.5 s per picture on a
 * CPU; this takes about 0.35 s and finds the same people, which is what following someone through a whole video needs.
 */
export const DETECT_SIZE = { shortest_edge: 320, longest_edge: 576 };

type RawDetection = { score: number; label: string; box: { xmin: number; ymin: number; xmax: number; ymax: number } };
type Detect = ((image: string, o: Record<string, unknown>) => Promise<RawDetection[]>) & {
  processor?: { image_processor?: { size?: unknown } };
};

const g = globalThis as unknown as { __detector?: Promise<Detect> };

export const detectorModelFile = () => path.join(modelsDir(), "Xenova", "yolos-tiny", "onnx", "model_quantized.onnx");

/**
 * The real detector: boxes for everything that can be followed, with the model's label. Loaded once and kept. `width`/`height` of the picture are needed to turn the model's pixel boxes into
 * fractions, so the caller passes the size of what it sampled.
 */
export function subjectDetector(size: { width: number; height: number }, onProgress?: (percent: number) => void): Detector {
  return async (imagePath) => {
    g.__detector ??= (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = modelsDir();
      const load = pipeline as unknown as (task: string, model: string, o: Record<string, unknown>) => Promise<Detect>;
      const detect = await load("object-detection", DETECTOR_MODEL, {
        dtype: "q8",
        progress_callback: (p: { status?: string; progress?: number }) => {
          if (p.status === "progress_total" && p.progress !== undefined) onProgress?.(p.progress);
        },
      });
      if (detect.processor?.image_processor) detect.processor.image_processor.size = DETECT_SIZE;
      return detect;
    })().catch((e) => {
      g.__detector = undefined; // let the next try start again instead of keeping a failed load
      throw new Error(`대상 인식 모델을 준비하지 못했습니다(인터넷 연결 확인): ${e instanceof Error ? e.message : e}`);
    });
    const detect = await g.__detector;
    const found = await detect(imagePath, { threshold: 0.4 });
    return found
      .filter((d) => isSubjectLabel(d.label))
      .map((d) => ({
        x0: Math.max(0, d.box.xmin / size.width),
        y0: Math.max(0, d.box.ymin / size.height),
        x1: Math.min(1, d.box.xmax / size.width),
        y1: Math.min(1, d.box.ymax / size.height),
        score: d.score,
        label: d.label,
      }));
  };
}
