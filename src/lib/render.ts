import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeStyle, styledText, type CaptionStyle } from "./captionStyle";
import { cropSizePx, cropX, cxAt, cyAt, panScript, type Keyframe } from "./reframe";

export const MAX_SHORT_SEC = 180;
export const MAX_LONG_SEC = 4 * 3600;

export type Layout = "short" | "long";

export type RenderOpts = {
  /** short = 1080x1920 vertical (Shorts/Reels), long = 1920x1080 horizontal. Defaults to short. */
  layout?: Layout;
  fit: "blur" | "cover"; // blur: whole frame over a blurred copy; cover: fill the frame and crop the overflow
  trimStart?: number;
  trimEnd?: number;
  /** Keep only these source ranges (seconds), joined in order. Replaces trimStart/trimEnd; captions then use the joined timeline. */
  segments?: { start: number; end: number }[];
  hook?: { text: string; seconds: number };
  captions: { start: number; end: number; text: string }[];
  ending?: { text: string; seconds: number };
  /** how the hook and caption text look; the default is the plain boxed style */
  style?: CaptionStyle;
  /**
   * For a vertical result from a wider source: where the crop window sits over time (centre as a fraction of the width, at times
   * in the source). Without it the whole picture is shown over a blurred copy of itself, as always.
   */
  reframe?: {
    keyframes: Keyframe[];
    /** 1 (default) = the window is as tall as the picture; above 1 it is that much smaller, so the subject fills more of the result */
    zoom?: number;
  };
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

export const FFMPEG = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

const FONT_CANDIDATES = [
  "C:/Windows/Fonts/malgunbd.ttf",
  "C:/Windows/Fonts/NanumGothicBold.ttf",
  "C:/Windows/Fonts/NanumGothic.ttf",
  "C:/Windows/Fonts/malgun.ttf",
  "/System/Library/Fonts/AppleSDGothicNeo.ttc",
  "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
];

export async function findFont() {
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

/**
 * Runs the bundled ffmpeg. `stderr` in the result keeps only the last 8 KB; pass `onStderr` to see all of it
 * (analysis passes print one line per silence or scene change and need the whole log).
 */
export function run(
  args: string[],
  cwd: string,
  timeoutMs = 10 * 60_000,
  onStdout?: (chunk: string) => void,
  onStderr?: (chunk: string) => void,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    // stdin is closed: ffmpeg never needs it here, and an idle open pipe can leave it waiting for keystrokes.
    const p = spawn(FFMPEG, ["-nostdin", ...args], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => {
      stderr = (stderr + d).slice(-8000);
      onStderr?.(String(d));
    });
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

export type Probe = { duration: number; width?: number; height?: number; hasAudio: boolean };

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
  return { duration, width, height, hasAudio: /Stream #\d+:\d+[^\n]*Audio:/.test(stderr) };
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
export function baseFilter(layout: Layout, fit: "blur" | "cover", src?: { width?: number; height?: number }, input = "0:v"): string {
  const { w: W, h: H } = LAYOUTS[layout];
  const exact = src?.width && src?.height && Math.abs(src.width / src.height - W / H) / (W / H) < 0.01;
  if (exact) return `[${input}]scale=${W}:${H},setsar=1[v0]`;
  if (fit === "cover") return `[${input}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[v0]`;
  // The backdrop is blurry anyway, so blur a 1/10-size copy and scale it back up: about 5x faster than blurring
  // the full frame, with no visible difference. That matters for long videos, which otherwise render near real time.
  const bw = Math.round(W / 10);
  const bh = Math.round(H / 10);
  return (
    `[${input}]split=2[a][b];[a]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=3:1,scale=${W}:${H}[bg];` +
    `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v0]`
  );
}

/** Validates keep-ranges against the file: inside it, in order, not overlapping, each at least MIN_PIECE_SEC long. */
/** The shortest piece that may be kept; jump cuts make short ones, so this is small. */
export const MIN_PIECE_SEC = 0.1;

export function joinSegments(segments: { start: number; end: number }[], duration: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const x of segments) {
    if (!(Number.isFinite(x.start) && Number.isFinite(x.end)) || x.start < 0 || x.end > duration + 0.05) {
      throw new Error("남길 구간이 영상 길이를 벗어났습니다. 구간 시간을 확인해 주세요.");
    }
    if (x.end - x.start < MIN_PIECE_SEC) throw new Error(`남길 구간은 ${MIN_PIECE_SEC}초 이상이어야 합니다.`);
    if (out.length && x.start < out[out.length - 1].end) throw new Error("남길 구간이 서로 겹치거나 시간 순서가 맞지 않습니다.");
    out.push({ start: x.start, end: Math.min(x.end, duration) });
  }
  return out;
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
  const segs = opts.segments?.length ? joinSegments(opts.segments, info.duration) : null;
  const start = segs ? 0 : Math.max(0, opts.trimStart ?? 0);
  const end = segs ? info.duration : Math.min(info.duration, opts.trimEnd && opts.trimEnd > 0 ? opts.trimEnd : info.duration);
  const outDur = segs ? segs.reduce((n, x) => n + x.end - x.start, 0) : end - start;
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

  const style = normalizeStyle(opts.style);
  const chain: string[] = [];
  if (opts.hook?.text.trim()) {
    const st = styledText("hook", L.hook, style, layout);
    const f = await textFile(opts.hook.text, st.wrap);
    const until = Math.min(opts.hook.seconds, outDur);
    chain.push(text(f, `${st.options}:enable='between(t,0,${sec(until)})'`));
  }
  // Captions stop where the ending card begins so they don't show through it.
  const captionsEnd = opts.ending?.text.trim() ? Math.max(0, outDur - opts.ending.seconds) : outDur;
  const captionStyle = styledText("caption", L.caption, style, layout);
  for (const c of opts.captions) {
    const capEnd = Math.min(c.end, captionsEnd);
    if (!c.text.trim() || capEnd <= c.start) continue;
    const f = await textFile(c.text, captionStyle.wrap);
    chain.push(text(f, `${captionStyle.options}:enable='between(t,${sec(c.start)},${sec(capEnd)})'`));
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

  // With segments, every kept range is cut out and the pieces are joined first; the layout filter then runs on the result.
  let pre = "";
  let vin = "0:v";
  if (segs) {
    const parts = segs.map((x, i) => {
      const v = `[0:v]trim=start=${sec(x.start)}:end=${sec(x.end)},setpts=PTS-STARTPTS[sv${i}]`;
      // A 12 ms fade at each end of every piece keeps the join from clicking, which matters when there are many cuts.
      const len = x.end - x.start;
      const fade = len >= 0.05 ? `,afade=t=in:st=0:d=0.012,afade=t=out:st=${(len - 0.012).toFixed(3)}:d=0.012` : "";
      const a = info.hasAudio ? `;[0:a]atrim=start=${sec(x.start)}:end=${sec(x.end)},asetpts=PTS-STARTPTS${fade}[sa${i}]` : "";
      return v + a;
    });
    const labels = segs.map((_, i) => `[sv${i}]${info.hasAudio ? `[sa${i}]` : ""}`).join("");
    pre = `${parts.join(";")};${labels}concat=n=${segs.length}:v=1:a=${info.hasAudio ? 1 : 0}[cv]${info.hasAudio ? "[ca]" : ""};`;
    vin = "cv";
  }
  // Following a person: a crop window as tall as the picture and 9:16 wide, moved by commands read from a file. It comes after the
  // pieces are joined, so the commands are in the result's time and each piece is mapped back to where it came from in the source.
  let frameInfo: { width?: number; height?: number } = info;
  const win = info.width && info.height ? cropSizePx(info.width, info.height, opts.reframe?.zoom) : null;
  if (opts.reframe?.keyframes.length && layout === "short" && info.width && info.height && win && (win.w < info.width * 0.98 || win.h < info.height * 0.98)) {
    const { w: cropW, h: cropH } = win;
    const toSource = segs
      ? (() => {
          const starts: number[] = [];
          let acc = 0;
          for (const x of segs) {
            starts.push(acc);
            acc += x.end - x.start;
          }
          return (t: number) => {
            let i = starts.length - 1;
            while (i > 0 && starts[i] > t) i--;
            return segs[i].start + Math.min(t - starts[i], segs[i].end - segs[i].start);
          };
        })()
      : (t: number) => t + start;
    await fs.writeFile(path.join(dir, "pan.txt"), panScript({ keys: opts.reframe.keyframes, srcW: info.width, cropW, srcH: info.height, cropH, outSec: outDur, toSource }), "utf8");
    const x0 = cropX(cxAt(opts.reframe.keyframes, toSource(0)), info.width, cropW);
    const y0 = cropH < info.height ? cropX(cyAt(opts.reframe.keyframes, toSource(0)), info.height, cropH) : 0;
    pre += `[${vin}]sendcmd=f=pan.txt,crop@pan=w=${cropW}:h=${cropH}:x=${x0}:y=${y0}[rf];`;
    vin = "rf";
    frameInfo = { width: cropW, height: cropH }; // already the frame's shape, so no blurred backdrop is needed
  }
  const graph = `${pre}${baseFilter(layout, opts.fit, frameInfo, vin)};[v0]${chain.length ? chain.join(",") : "null"}[vout]`;

  // The graph goes through a file: with a few hundred cuts it is longer than a command line may be (Windows allows ~32 KB).
  await fs.writeFile(path.join(dir, "graph.txt"), graph, "utf8");

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
      ...(segs ? ["-i", input] : ["-ss", sec(start), "-i", input, "-t", sec(outDur)]),
      "-filter_complex_script", "graph.txt",
      "-map", "[vout]", ...(segs ? (info.hasAudio ? ["-map", "[ca]"] : []) : ["-map", "0:a?"]),
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
