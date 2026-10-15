import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

export const MAX_SHORT_SEC = 180;

export type RenderOpts = {
  fit: "blur" | "cover"; // blur: whole frame over a blurred copy; cover: fill 9:16 and crop the sides
  trimStart?: number;
  trimEnd?: number;
  hook?: { text: string; seconds: number };
  captions: { start: number; end: number; text: string }[];
  ending?: { text: string; seconds: number };
};

const FFMPEG = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

const FONT_CANDIDATES = [
  "C:/Windows/Fonts/malgunbd.ttf",
  "C:/Windows/Fonts/NanumGothicBold.ttf",
  "C:/Windows/Fonts/NanumGothic.ttf",
  "C:/Windows/Fonts/malgun.ttf",
  "/System/Library/Fonts/AppleSDGothicNeo.ttc",
  "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
];

async function findFont() {
  for (const f of FONT_CANDIDATES) {
    try {
      await fs.access(f);
      return f;
    } catch {
      /* try next */
    }
  }
  throw new Error("한글 폰트를 찾지 못했습니다. 맑은 고딕이나 나눔고딕을 설치해 주세요.");
}

function run(args: string[], cwd: string, timeoutMs = 10 * 60_000): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { cwd, windowsHide: true });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error("렌더링 시간이 너무 오래 걸려 중단했습니다."));
    }, timeoutMs);
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`FFmpeg를 실행하지 못했습니다: ${e.message}`));
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

async function probeDuration(input: string, cwd: string): Promise<number> {
  const { stderr } = await run(["-hide_banner", "-i", input], cwd, 30_000); // exits non-zero without an output, that's fine
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!m) throw new Error("영상 파일을 읽지 못했습니다. 지원하는 영상 형식(mp4, mov, webm, mkv)인지 확인해 주세요.");
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Wrap on spaces to roughly `max` full-width characters per line; drop emoji the font can't draw. */
export function wrap(text: string, max: number): string {
  const clean = text.replace(/[\u{10000}-\u{10FFFF}]/gu, "").replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  let cur = "";
  for (const w of clean.split(" ")) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= max) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    cur = w;
    while (cur.length > max) {
      lines.push(cur.slice(0, max));
      cur = cur.slice(max);
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4).join("\n");
}

const sec = (n: number) => n.toFixed(2);

export async function renderVideo(input: string, dir: string, opts: RenderOpts) {
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(await findFont(), path.join(dir, "font.ttf"));

  const total = await probeDuration(input, dir);
  const start = Math.max(0, opts.trimStart ?? 0);
  const end = Math.min(total, opts.trimEnd && opts.trimEnd > 0 ? opts.trimEnd : total);
  const outDur = end - start;
  if (outDur < 1) throw new Error("자르고 남은 길이가 1초 미만입니다. 시작/끝 시간을 확인해 주세요.");
  if (outDur > MAX_SHORT_SEC) {
    throw new Error(`쇼츠는 ${MAX_SHORT_SEC}초(3분) 이하여야 합니다. 현재 ${Math.round(outDur)}초입니다. 시작/끝 시간으로 줄여 주세요.`);
  }

  // Overlay text goes through UTF-8 files so Korean never meets shell/filter escaping.
  let n = 0;
  const textFile = async (text: string, max: number) => {
    const name = `t${n++}.txt`;
    await fs.writeFile(path.join(dir, name), wrap(text, max), "utf8");
    return name;
  };
  const text = (file: string, o: string) => `drawtext=fontfile=font.ttf:textfile=${file}:reload=0:${o}`;

  const chain: string[] = [];
  if (opts.hook?.text.trim()) {
    const f = await textFile(opts.hook.text, 12);
    const until = Math.min(opts.hook.seconds, outDur);
    chain.push(
      text(f, `fontsize=76:fontcolor=white:borderw=7:bordercolor=black@0.9:x=(w-text_w)/2:y=h*0.10:line_spacing=16:enable='between(t,0,${sec(until)})'`),
    );
  }
  for (const c of opts.captions) {
    if (!c.text.trim() || c.end <= c.start || c.start >= outDur) continue;
    const f = await textFile(c.text, 13);
    chain.push(
      text(f, `fontsize=58:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=22:x=(w-text_w)/2:y=h*0.70:line_spacing=12:enable='between(t,${sec(c.start)},${sec(Math.min(c.end, outDur))})'`),
    );
  }
  if (opts.ending?.text.trim()) {
    const f = await textFile(opts.ending.text, 10);
    const from = Math.max(0, outDur - opts.ending.seconds);
    chain.push(`drawbox=x=0:y=0:w=iw:h=ih:color=black@0.65:t=fill:enable='gte(t,${sec(from)})'`);
    chain.push(
      text(f, `fontsize=88:fontcolor=white:borderw=6:bordercolor=black@0.8:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=18:enable='gte(t,${sec(from)})'`),
    );
  }

  const base =
    opts.fit === "cover"
      ? "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v0]"
      : "[0:v]split=2[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:6[bg];[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v0]";
  const graph = `${base};[v0]${chain.length ? chain.join(",") : "null"}[vout]`;

  const { code, stderr } = await run(
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-ss", sec(start), "-i", input, "-t", sec(outDur),
      "-filter_complex", graph,
      "-map", "[vout]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
      "output.mp4",
    ],
    dir,
  );
  if (code !== 0) throw new Error(`렌더링 실패: ${stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300)}`);

  const { size } = await fs.stat(path.join(dir, "output.mp4"));
  return { durationSec: Math.round(outDur * 10) / 10, bytes: size };
}
