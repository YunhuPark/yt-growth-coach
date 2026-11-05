// Puts the frames recorded by record-tour.mjs together into one mp4 at their real timing, with the marked long waits sped up.
//
//   node scripts/assemble-tour.mjs [workDir] [target.mp4] [width] [crf] [speedUp]
//
// public/demo/tour.mp4 was made with:  node scripts/assemble-tour.mjs tour-work public/demo/tour.mp4 960 27 1.25
// Needs ffmpeg: FFMPEG_PATH, or the one installed with the project.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const OUT = path.resolve(process.argv[2] ?? "tour-work");
const FFMPEG = process.env.FFMPEG_PATH || path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const { frames, marks } = JSON.parse(readFileSync(path.join(OUT, "frames.json"), "utf8"));
const target = path.resolve(process.argv[3] ?? path.join(OUT, "tour.mp4"));
const width = Number(process.argv[4] ?? 960);
const crf = process.argv[5] ?? "27";
const speedUp = Number(process.argv[6] ?? 1);

/** The time an interval of the recording takes in the result: marked stretches run faster. */
const scaled = (a, b) => {
  let total = b - a;
  for (const m of marks) {
    const ov = Math.max(0, Math.min(b, m.to) - Math.max(a, m.from));
    total -= ov * (1 - 1 / m.speed);
  }
  return Math.max(0.01, total);
};

const lines = [];
let sum = 0;
frames.forEach((f, i) => {
  const next = frames[i + 1];
  const d = (next ? scaled(f.t, next.t) : 1.8) / speedUp;
  sum += d;
  lines.push(`file 'frames/f${String(f.n).padStart(6, "0")}.jpg'`, `duration ${d.toFixed(4)}`);
});
// the concat demuxer ignores the last duration unless the file is repeated
lines.push(`file 'frames/f${String(frames[frames.length - 1].n).padStart(6, "0")}.jpg'`);
writeFileSync(path.join(OUT, "list.txt"), lines.join("\n"));
console.log("frames:", frames.length, "result length:", sum.toFixed(1), "s; sped up:", marks.map((m) => `${(m.to - m.from).toFixed(0)}s x${m.speed}`).join(", "));

const r = spawnSync(
  FFMPEG,
  ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "list.txt", "-vf", `fps=25,scale=${width}:-2:flags=lanczos,format=yuv420p`, "-c:v", "libx264", "-preset", "slow", "-crf", crf, "-an", "-movflags", "+faststart", target],
  { cwd: OUT },
);
if (r.status !== 0) throw new Error(String(r.stderr));
console.log("wrote", target);
