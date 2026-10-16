import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

export const MAX_SHORT_SEC = 180;
export const MAX_LONG_SEC = 4 * 3600;

export type Layout = "short" | "long";

export type RenderOpts = {
  /** short = 1080x1920 vertical (Shorts/Reels), long = 1920x1080 horizontal. Defaults to short. */
  layout?: Layout;
  fit: "blur" | "cover"; // blur: whole frame over a blurred copy; cover: fill the frame and crop the overflow
  trimStart?: number;
  trimEnd?: number;
  hook?: { text: string; seconds: number };
  captions: { start: number; end: number; text: string }[];
  ending?: { text: string; seconds: number };
};

type TextStyle = { size: number; border?: number; box?: number; y: string; wrap: number; spacing: number };

// Sizes are tuned per frame size: a 1080-wide vertical frame and a 1920-wide horizontal frame need different type.
export const LAYOUTS: Record<
  Layout,
  { w: number; h: number; maxSec: number; hook: TextStyle; caption: TextStyle; ending: TextStyle & { dim: number } }
> = {
  short: {
    w: 1080,
    h: 1920,
    maxSec: MAX_SHORT_SEC,
    hook: { size: 76, border: 7, y: "h*0.10", wrap: 12, spacing: 16 },
    caption: { size: 58, box: 22, y: "h*0.70", wrap: 13, spacing: 12 },
    ending: { size: 88, border: 6, y: "(h-text_h)/2", wrap: 10, spacing: 18, dim: 0.65 },
  },
  long: {
    w: 1920,
    h: 1080,
    maxSec: MAX_LONG_SEC,
    hook: { size: 64, border: 5, y: "h*0.08", wrap: 22, spacing: 12 },
    caption: { size: 44, box: 16, y: "h*0.80", wrap: 30, spacing: 8 },
    // Upper third only, so the centre and bottom stay free for YouTube's own end-screen elements.
    ending: { size: 72, border: 5, y: "h*0.18", wrap: 18, spacing: 14, dim: 0.55 },
  },
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

function run(
  args: string[],
  cwd: string,
  timeoutMs = 10 * 60_000,
  onStdout?: (chunk: string) => void,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    // stdin is closed: ffmpeg never needs it here, and an idle open pipe can leave it waiting for keystrokes.
    const p = spawn(FFMPEG, ["-nostdin", ...args], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr = (stderr + d).slice(-8000)));
    if (onStdout) p.stdout.on("data", (d) => onStdout(String(d)));
    else p.stdout.resume();
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

export type Probe = { duration: number; width?: number; height?: number };

/** Duration and displayed frame size, read from ffmpeg's banner (it exits non-zero without an output, that's fine). */
export async function probe(input: string, cwd: string): Promise<Probe> {
  const { stderr } = await run(["-hide_banner", "-i", input], cwd, 60_000);
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!d) throw new Error("영상 파일을 읽지 못했습니다. 지원하는 영상 형식(mp4, mov, webm, mkv)인지 확인해 주세요.");
  const duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
  const v = /Video:[^\n]*?,\s*(\d{2,5})x(\d{2,5})/.exec(stderr);
  let width = v ? Number(v[1]) : undefined;
  let height = v ? Number(v[2]) : undefined;
  // Phone footage is often stored sideways with a rotation tag; ffmpeg rotates it, so the shown size is swapped.
  const rot = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(stderr);
  if (rot && width && height && Math.abs(Math.round(Number(rot[1]))) % 180 === 90) [width, height] = [height, width];
  return { duration, width, height };
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
  // Two lines: split at the space that makes them closest in length, so no single word is left alone below.
  if (lines.length === 2 && clean.includes(" ")) {
    let best = -1;
    let gap = Infinity;
    for (let i = 0; i < clean.length; i++) {
      if (clean[i] !== " ") continue;
      const g = Math.abs(i - (clean.length - i - 1));
      if (Math.max(i, clean.length - i - 1) <= max + 2 && g < gap) {
        gap = g;
        best = i;
      }
    }
    if (best > 0) return `${clean.slice(0, best)}\n${clean.slice(best + 1)}`;
  }
  return lines.slice(0, 4).join("\n");
}

const sec = (n: number) => n.toFixed(2);

/** The video filter that turns the source into the layout's frame. Exact-aspect sources skip the costly blur. */
export function baseFilter(layout: Layout, fit: "blur" | "cover", src?: { width?: number; height?: number }): string {
  const { w: W, h: H } = LAYOUTS[layout];
  const exact = src?.width && src?.height && Math.abs(src.width / src.height - W / H) / (W / H) < 0.01;
  if (exact) return `[0:v]scale=${W}:${H},setsar=1[v0]`;
  if (fit === "cover") return `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[v0]`;
  return (
    `[0:v]split=2[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:6[bg];` +
    `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v0]`
  );
}

export async function renderVideo(
  input: string,
  dir: string,
  opts: RenderOpts,
  onProgress?: (fraction: number) => void,
) {
  const layout: Layout = opts.layout ?? "short";
  const L = LAYOUTS[layout];
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(await findFont(), path.join(dir, "font.ttf"));

  const info = await probe(input, dir);
  const start = Math.max(0, opts.trimStart ?? 0);
  const end = Math.min(info.duration, opts.trimEnd && opts.trimEnd > 0 ? opts.trimEnd : info.duration);
  const outDur = end - start;
  if (outDur < 1) throw new Error("자르고 남은 길이가 1초 미만입니다. 시작/끝 시간을 확인해 주세요.");
  if (outDur > L.maxSec) {
    throw new Error(
      layout === "short"
        ? `쇼츠는 ${MAX_SHORT_SEC}초(3분) 이하여야 합니다. 현재 ${Math.round(outDur)}초입니다. 시작/끝 시간으로 줄이거나 롱폼으로 만들어 주세요.`
        : `롱폼은 최대 ${MAX_LONG_SEC / 3600}시간까지 만들 수 있습니다. 현재 ${Math.round(outDur / 60)}분입니다.`,
    );
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
    const s = L.hook;
    const f = await textFile(opts.hook.text, s.wrap);
    const until = Math.min(opts.hook.seconds, outDur);
    chain.push(
      text(f, `fontsize=${s.size}:fontcolor=white:borderw=${s.border}:bordercolor=black@0.9:x=(w-text_w)/2:y=${s.y}:line_spacing=${s.spacing}:enable='between(t,0,${sec(until)})'`),
    );
  }
  // Captions stop where the ending card begins so they don't show through it.
  const captionsEnd = opts.ending?.text.trim() ? Math.max(0, outDur - opts.ending.seconds) : outDur;
  for (const c of opts.captions) {
    const s = L.caption;
    const capEnd = Math.min(c.end, captionsEnd);
    if (!c.text.trim() || capEnd <= c.start) continue;
    const f = await textFile(c.text, s.wrap);
    chain.push(
      text(f, `fontsize=${s.size}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=${s.box}:x=(w-text_w)/2:y=${s.y}:line_spacing=${s.spacing}:enable='between(t,${sec(c.start)},${sec(capEnd)})'`),
    );
  }
  if (opts.ending?.text.trim()) {
    const s = L.ending;
    const f = await textFile(opts.ending.text, s.wrap);
    const from = Math.max(0, outDur - opts.ending.seconds);
    chain.push(`drawbox=x=0:y=0:w=iw:h=ih:color=black@${s.dim}:t=fill:enable='gte(t,${sec(from)})'`);
    chain.push(
      text(f, `fontsize=${s.size}:fontcolor=white:borderw=${s.border}:bordercolor=black@0.8:x=(w-text_w)/2:y=${s.y}:line_spacing=${s.spacing}:enable='gte(t,${sec(from)})'`),
    );
  }

  const graph = `${baseFilter(layout, opts.fit, info)};[v0]${chain.length ? chain.join(",") : "null"}[vout]`;

  // ffmpeg reports its position on stdout (out_time_us / out_time_ms, both in microseconds).
  let buffer = "";
  const onStdout = (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
      if (m) onProgress?.(Math.min(1, Number(m[1]) / 1e6 / outDur));
    }
  };

  const { code, stderr } = await run(
    [
      "-y", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats",
      "-ss", sec(start), "-i", input, "-t", sec(outDur),
      "-filter_complex", graph,
      "-map", "[vout]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
      "output.mp4",
    ],
    dir,
    Math.max(10 * 60_000, outDur * 3000), // allow ~3x real time before giving up
    onStdout,
  );
  if (code !== 0) throw new Error(`렌더링 실패: ${stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300)}`);

  onProgress?.(1);
  const { size } = await fs.stat(path.join(dir, "output.mp4"));
  return { durationSec: Math.round(outDur * 10) / 10, bytes: size, layout };
}
