import { promises as fs } from "node:fs";
import path from "node:path";
import { modelsDir } from "./transcribe";

// Finds faces in a picture, on this computer: YuNet from the OpenCV model zoo (MIT licence, about 230 KB), run with onnxruntime.
// A person's body box is a poor guide to where the face is once the person fills the picture (it takes in shoulders and arms), so
// following someone uses the face when this finds one. The model is downloaded once into .data/models; the pictures never leave
// the machine. If it cannot be had (offline), callers carry on with the body box alone.

export const FACE_MODEL_URL = "https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx";
export const FACE_MODEL_SIZE_KB = 233;
export const faceModelFile = () => path.join(modelsDir(), "opencv", "face_detection_yunet", "face_detection_yunet_2023mar.onnx");

export type FaceBox = { x0: number; y0: number; x1: number; y1: number; score: number };
export type FaceFinder = (imagePath: string) => Promise<FaceBox[]>;

const SIZE = 640; // the model takes a fixed 640 x 640 picture
const STRIDES = [8, 16, 32];

type Ort = typeof import("onnxruntime-node");
type Session = Awaited<ReturnType<Ort["InferenceSession"]["create"]>>;
const g = globalThis as unknown as { __face?: Promise<{ ort: Ort; session: Session } | null> };

async function ensureModel(): Promise<string | null> {
  const file = faceModelFile();
  try {
    if ((await fs.stat(file)).size > 100_000) return file;
  } catch {
    /* not there yet */
  }
  try {
    const res = await fetch(FACE_MODEL_URL, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 100_000) return null; // a redirect page or an error body, not the model
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file + ".part", bytes);
    await fs.rename(file + ".part", file);
    return file;
  } catch {
    return null;
  }
}

function load() {
  g.__face ??= (async () => {
    const file = await ensureModel();
    if (!file) return null;
    try {
      const ort = (await import("onnxruntime-node")) as Ort;
      return { ort, session: await ort.InferenceSession.create(file) };
    } catch {
      return null;
    }
  })();
  return g.__face;
}

/** The faces YuNet is sure about, as fractions of the picture. Overlapping boxes for one face are merged. */
export function decodeFaces(
  out: Record<string, { data: ArrayLike<number> }>,
  scale: number,
  size: { width: number; height: number },
  minScore = 0.6,
): FaceBox[] {
  const found: FaceBox[] = [];
  for (const stride of STRIDES) {
    const cols = SIZE / stride;
    const cls = out[`cls_${stride}`].data;
    const obj = out[`obj_${stride}`].data;
    const box = out[`bbox_${stride}`].data;
    for (let i = 0; i < cols * cols; i++) {
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
      if (score < minScore) continue;
      const row = Math.floor(i / cols);
      const col = i % cols;
      const cx = (col + box[i * 4]) * stride;
      const cy = (row + box[i * 4 + 1]) * stride;
      const w = Math.exp(box[i * 4 + 2]) * stride;
      const h = Math.exp(box[i * 4 + 3]) * stride;
      found.push({
        x0: Math.max(0, (cx - w / 2) / scale / size.width),
        y0: Math.max(0, (cy - h / 2) / scale / size.height),
        x1: Math.min(1, (cx + w / 2) / scale / size.width),
        y1: Math.min(1, (cy + h / 2) / scale / size.height),
        score,
      });
    }
  }
  found.sort((a, b) => b.score - a.score);
  const kept: FaceBox[] = [];
  for (const b of found) {
    const overlaps = kept.some((k) => {
      const iw = Math.min(k.x1, b.x1) - Math.max(k.x0, b.x0);
      const ih = Math.min(k.y1, b.y1) - Math.max(k.y0, b.y0);
      if (iw <= 0 || ih <= 0) return false;
      const inter = iw * ih;
      return inter / ((k.x1 - k.x0) * (k.y1 - k.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter) > 0.3;
    });
    if (!overlaps) kept.push(b);
  }
  return kept.filter((b) => b.x1 > b.x0 && b.y1 > b.y0);
}

/** The real finder; resolves to no faces (never throws) when the model or the engine is not available. */
export const faceFinder: FaceFinder = async (imagePath) => {
  try {
    const engine = await load();
    if (!engine) return [];
    const sharp = (await import("sharp")).default;
    const meta = await sharp(imagePath).metadata();
    if (!meta.width || !meta.height) return [];
    const scale = Math.min(SIZE / meta.width, SIZE / meta.height);
    const w = Math.max(1, Math.round(meta.width * scale));
    const h = Math.max(1, Math.round(meta.height * scale));
    const { data } = await sharp(imagePath)
      .resize(w, h)
      .extend({ right: SIZE - w, bottom: SIZE - h, background: { r: 0, g: 0, b: 0 } })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const px = SIZE * SIZE;
    const input = new Float32Array(3 * px); // blue, green, red planes, 0..255, as the model was trained
    for (let i = 0; i < px; i++) {
      input[i] = data[i * 3 + 2];
      input[px + i] = data[i * 3 + 1];
      input[2 * px + i] = data[i * 3];
    }
    const out = await engine.session.run({ input: new engine.ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) });
    return decodeFaces(out as unknown as Record<string, { data: ArrayLike<number> }>, scale, { width: meta.width, height: meta.height });
  } catch {
    return [];
  }
};
