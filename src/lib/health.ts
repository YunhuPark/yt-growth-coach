import { promises as fs } from "node:fs";
import path from "node:path";
import { ffmpegHasFilter, FFMPEG, findFont } from "./render";
import { loadTokens } from "./store";

// "Is everything this app needs in place?", answered as yes/no per item. It never returns a secret, only whether one is set.

export type HealthItem = {
  id: "ffmpeg" | "font" | "anthropic" | "youtubeKey" | "speechModel" | "personModel" | "google";
  ok: boolean;
  /** without this the editing tools cannot run */
  required: boolean;
  /** what to do when it is missing */
  fix: string;
};

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

export const speechModelFile = () =>
  path.join(process.cwd(), ".data", "models", "Xenova", "whisper-small", "onnx", "encoder_model_quantized.onnx");

export const personModelFile = () => path.join(process.cwd(), ".data", "models", "Xenova", "yolos-tiny", "onnx", "model_quantized.onnx");

export async function checkHealth(): Promise<HealthItem[]> {
  const [ffmpeg, drawtext, font, speech, person, tokens] = await Promise.all([
    exists(FFMPEG),
    ffmpegHasFilter("drawtext"),
    findFont().then(
      () => true,
      () => false,
    ),
    exists(speechModelFile()),
    exists(personModelFile()),
    loadTokens().catch(() => null),
  ]);
  return [
    {
      id: "ffmpeg",
      ok: ffmpeg && drawtext,
      required: true,
      fix: ffmpeg
        ? "이 ffmpeg에는 글자를 그리는 기능(drawtext)이 없어 자막과 훅을 넣을 수 없습니다. 전체 기능을 가진 ffmpeg(예: Linux는 apt의 ffmpeg)를 설치하고 환경변수 FFMPEG_PATH에 그 경로를 지정해 주세요."
        : "영상 처리 엔진(ffmpeg)이 없습니다. 프로젝트 폴더에서 npm install을 다시 실행하거나, 환경변수 FFMPEG_PATH에 ffmpeg 경로를 지정해 주세요.",
    },
    { id: "font", ok: font, required: true, fix: "자막에 쓸 한글 폰트가 없습니다. 맑은 고딕이나 나눔고딕을 설치해 주세요." },
    {
      id: "anthropic",
      ok: !!process.env.ANTHROPIC_API_KEY,
      required: true,
      fix: "AI 기능에 필요한 키가 없습니다. .env.local 파일에 ANTHROPIC_API_KEY=… 를 넣고 서버를 다시 시작해 주세요.",
    },
    {
      id: "youtubeKey",
      ok: !!process.env.YOUTUBE_API_KEY,
      required: false,
      fix: "영상 주소 분석에서 댓글을 읽으려면 .env.local에 YOUTUBE_API_KEY가 필요합니다(없으면 제목·설명·이미지만 씁니다).",
    },
    {
      id: "speechModel",
      ok: speech,
      required: false,
      fix: "음성 인식 모델이 아직 없습니다. 음성 인식을 처음 켤 때 약 240MB를 자동으로 내려받아 저장합니다.",
    },
    {
      id: "personModel",
      ok: person,
      required: false,
      fix: "대상 인식 모델이 아직 없습니다. 자동 프레임을 처음 쓸 때 약 9MB를 자동으로 내려받아 저장합니다.",
    },
    {
      id: "google",
      ok: !!tokens,
      required: false,
      fix: "채널 분석·AI 추천·성과 추적을 쓰려면 Google 계정을 연결해야 합니다. 영상 편집 도구에는 필요하지 않습니다.",
    },
  ];
}
