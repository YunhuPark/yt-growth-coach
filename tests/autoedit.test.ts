import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { analyzeVideo, parseLoudness, parseSceneTimes, parseSilences, pickFrameTimes, summarizeLoudness } from "../src/lib/analyzeVideo";
import { describeAnalysis, planEdit, sanitizePlan, type RawPlan } from "../src/lib/autoEdit";
import { joinSegments, probe, renderVideo } from "../src/lib/render";

const FFMPEG = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const FONTS = [
  "C:/Windows/Fonts/malgunbd.ttf",
  "C:/Windows/Fonts/malgun.ttf",
  "C:/Windows/Fonts/NanumGothic.ttf",
  "/System/Library/Fonts/AppleSDGothicNeo.ttc",
  "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
];
const canRender = existsSync(FFMPEG) && FONTS.some((f) => existsSync(f));

describe("analysis parsers", () => {
  it("reads scene-change times from showinfo lines", () => {
    const log = [
      "[Parsed_showinfo_2 @ 0x1] n:   0 pts:  3840 pts_time:0.25 duration: 1",
      "[Parsed_showinfo_2 @ 0x1] n:   1 pts: 12800 pts_time:12.5 duration: 1",
      "noise pts_time:99",
    ].join("\n");
    assert.deepEqual(parseSceneTimes(log), [0.25, 12.5]);
  });

  it("pairs silence starts and ends, closing one still open at the end of the file", () => {
    const log = [
      "[silencedetect @ 0x1] silence_start: 2.02",
      "[silencedetect @ 0x1] silence_end: 3.5 | silence_duration: 1.48",
      "frame= 0 [silencedetect @ 0x1] silence_start: 8",
    ].join("\n");
    assert.deepEqual(parseSilences(log, 10), [{ start: 2.02, end: 3.5 }, { start: 8, end: 10 }]);
  });

  it("reads per-second loudness, including digital silence printed as -inf", () => {
    const log = [
      "[Parsed_ametadata_2 @ 0x1] frame:0 pts:0 pts_time:0",
      "[Parsed_ametadata_2 @ 0x1] lavfi.astats.Overall.RMS_level=-21.5",
      "size=N/A [Parsed_ametadata_2 @ 0x1] frame:1 pts:44100 pts_time:1",
      "[Parsed_ametadata_2 @ 0x1] lavfi.astats.Overall.RMS_level=-inf",
    ].join("\n");
    assert.deepEqual(parseLoudness(log), [{ t: 0, db: -21.5 }, { t: 1, db: -90 }]);
  });

  it("summarises loudness into buckets using the peak", () => {
    const l = [-30, -10, -40, -50].map((db, t) => ({ t, db }));
    assert.deepEqual(summarizeLoudness(l, 2), [{ t: 0, db: -10 }, { t: 2, db: -40 }]);
    assert.equal(summarizeLoudness(l, 1).length, 4);
  });

  it("picks frame times that cover the video, include scene changes, and stay within the cap", () => {
    const times = pickFrameTimes(60, [10, 10.3, 40], 8);
    assert.ok(times.length <= 8 && times.length >= 4);
    assert.ok(times.every((t) => t >= 0 && t < 60));
    assert.ok(times.every((t, i) => i === 0 || t > times[i - 1]));
    assert.ok(times[0] < 15 && times[times.length - 1] > 45, "covers both ends");
    assert.deepEqual(pickFrameTimes(0, []), []);
    assert.equal(pickFrameTimes(2, []).length, 1);
  });
});

const raw = (over: Partial<RawPlan> = {}): RawPlan => ({
  summary: "요약",
  segments: [{ start: 0, end: 5, reason: "시작" }],
  hook: null,
  captions: [],
  ending: null,
  titles: ["a", "b", "c"],
  description: "설명",
  hashtags: ["쇼츠"],
  chapters: [],
  ...over,
});

describe("sanitizePlan", () => {
  const opts = { duration: 60, layout: "short" as const };

  it("clamps, sorts and merges the segments", () => {
    const p = sanitizePlan(
      raw({
        segments: [
          { start: 30, end: 80, reason: "c" },
          { start: -5, end: 10, reason: "a" },
          { start: 9.9, end: 15, reason: "b" },
          { start: 20, end: 20.2, reason: "tiny" },
        ],
      }),
      opts,
    );
    assert.deepEqual(p.segments.map((s) => [s.start, s.end]), [[0, 15], [30, 60]]);
    assert.equal(p.outputSec, 45);
  });

  it("falls back to the opening of the video when the model gives nothing usable", () => {
    const p = sanitizePlan(raw({ segments: [{ start: 100, end: 120, reason: "x" }] }), { ...opts, targetSec: 20 });
    assert.deepEqual(p.segments.map((s) => [s.start, s.end]), [[0, 20]]);
    assert.ok(p.warnings.length);
  });

  it("keeps a short under 180 seconds by trimming from the end", () => {
    const all = raw({ segments: [{ start: 0, end: 200, reason: "all" }] });
    const p = sanitizePlan(all, { duration: 300, layout: "short" });
    assert.equal(p.outputSec, 180);
    assert.ok(p.warnings.some((w) => /길이 제한/.test(w)));
    assert.equal(sanitizePlan(all, { duration: 300, layout: "long" }).outputSec, 200);
  });

  it("moves captions onto the edited timeline and drops those in cut parts", () => {
    const p = sanitizePlan(
      raw({
        segments: [{ start: 10, end: 20, reason: "a" }, { start: 40, end: 50, reason: "b" }],
        captions: [
          { start: 12, end: 14, text: "첫째" },
          { start: 25, end: 27, text: "잘린 부분" },
          { start: 42, end: 44, text: "둘째" },
          { start: 49, end: 58, text: "끝 넘어감" },
        ],
      }),
      opts,
    );
    assert.deepEqual(p.captions.map((c) => [c.start, c.end, c.text]), [[2, 4, "첫째"], [12, 14, "둘째"], [19, 20, "끝 넘어감"]]);
  });

  it("strips [placeholders] and control characters from every text field", () => {
    const p = sanitizePlan(
      raw({
        segments: [{ start: 0, end: 20, reason: "x" }],
        hook: { text: "  [빈칸] 이거\n봐  ", seconds: 99 },
        captions: [{ start: 0, end: 2, text: "[x]" }, { start: 2, end: 4, text: "정상" }],
        ending: "[채널명] 구독",
        titles: ["[a] 제목", "제목", "제목", ""],
        hashtags: ["#쇼츠", "쇼츠", "a b"],
      }),
      opts,
    );
    assert.equal(p.hook?.text, "이거 봐");
    assert.ok(p.hook!.seconds <= 6);
    assert.deepEqual(p.captions.map((c) => c.text), ["정상"]);
    assert.equal(p.ending?.text, "구독");
    assert.equal(sanitizePlan(raw({ ending: "구독" }), opts).ending, null, "no ending card on a clip of 6 seconds or less");
    assert.deepEqual(p.titles, ["제목"]);
    assert.deepEqual(p.hashtags, ["#쇼츠", "#ab"]);
  });

  it("trims overlapping captions so two are never on screen together", () => {
    const p = sanitizePlan(raw({ captions: [{ start: 0, end: 4, text: "하나" }, { start: 2, end: 5, text: "둘" }] }), opts);
    assert.ok(p.captions[0].end <= p.captions[1].start);
  });
});

describe("planEdit", () => {
  const analysis = {
    duration: 30, width: 640, height: 360, hasAudio: true,
    scenes: [5], silences: [{ start: 10, end: 12 }], loudness: [{ t: 0, db: -20 }], frames: [],
  };

  it("passes the facts to the model and returns a sanitized plan", async () => {
    let sent = "";
    const plan = await planEdit(analysis, { layout: "short", topic: "테스트 주제", targetSec: 20 }, async (_sys, content) => {
      sent = content.map((c) => (c.type === "text" ? c.text : "<img>")).join("\n");
      return raw({ segments: [{ start: 0, end: 40, reason: "전부" }] });
    });
    assert.match(sent, /테스트 주제/);
    assert.match(sent, /무음 구간\(초\): 10\.0~12\.0/);
    assert.equal(plan.segments[0].end, 30, "clamped to the real length");
  });

  it("describes a file without audio without loudness data", () => {
    const text = describeAnalysis({ ...analysis, hasAudio: false, silences: [], loudness: [], scenes: [] }, { layout: "long", topic: "", targetSec: 600 });
    assert.match(text, /소리 없음/);
    assert.doesNotMatch(text, /소리 크기/);
  });
});

describe("segment validation", () => {
  it("rejects ranges outside the file, overlapping, or too short", () => {
    assert.throws(() => joinSegments([{ start: 0, end: 12 }], 10), /벗어났/);
    assert.throws(() => joinSegments([{ start: 0, end: 5 }, { start: 4, end: 8 }], 10), /겹치/);
    assert.throws(() => joinSegments([{ start: 0, end: 0.05 }], 10), /0.1초/);
    assert.deepEqual(joinSegments([{ start: 0, end: 0.3 }], 10), [{ start: 0, end: 0.3 }], "a short piece is fine: jump cuts make them");
    assert.deepEqual(joinSegments([{ start: 1, end: 3 }, { start: 5, end: 9 }], 10), [{ start: 1, end: 3 }, { start: 5, end: 9 }]);
  });
});

describe("with real ffmpeg", { skip: !canRender ? "needs the bundled ffmpeg and a Korean font" : false, timeout: 180_000 }, () => {
  let dir: string;
  const make = (name: string, args: string[]) => {
    const out = path.join(dir, name);
    const r = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...args, out]);
    assert.equal(r.status, 0, String(r.stderr));
    return out;
  };
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ytgc-auto-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("finds a hard scene cut and a silent stretch, and extracts frames", async () => {
    // 3 s red, 3 s blue; the tone is muted from 2 s to 3.5 s
    const src = make("a.mp4", [
      "-f", "lavfi", "-i", "color=c=red:s=160x90:r=10:d=3",
      "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=10:d=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v];[2:a]volume=enable='between(t,2,3.5)':volume=0[a]",
      "-map", "[v]", "-map", "[a]", "-pix_fmt", "yuv420p", "-shortest",
    ]);
    const work = path.join(dir, "an");
    const stages: string[] = [];
    const a = await analyzeVideo(src, work, (s) => stages.push(s));
    assert.equal(a.hasAudio, true);
    assert.ok(a.scenes.some((t) => Math.abs(t - 3) < 0.3), `scene near 3 s, got ${a.scenes}`);
    assert.ok(a.silences.some((s) => Math.abs(s.start - 2) < 0.2 && s.end - s.start > 1), `silence near 2-3.5 s, got ${JSON.stringify(a.silences)}`);
    assert.ok(a.loudness.length >= 5);
    assert.ok(a.frames.length >= 2 && a.frames.every((f) => existsSync(f.file)));
    assert.equal(stages.length, 3);
  });

  it("reports no audio for a silent file and still analyses it", async () => {
    const src = make("v.mp4", ["-f", "lavfi", "-i", "testsrc2=s=160x90:r=10:d=2", "-pix_fmt", "yuv420p"]);
    const a = await analyzeVideo(src, path.join(dir, "an-v"));
    assert.equal(a.hasAudio, false);
    assert.deepEqual(a.silences, []);
  });

  it("cuts and joins segments: the output is as long as the kept parts, with audio", async () => {
    const src = make("s.mp4", [
      "-f", "lavfi", "-i", "testsrc2=s=320x180:r=10:d=8",
      "-f", "lavfi", "-i", "sine=frequency=330:duration=8",
      "-pix_fmt", "yuv420p", "-shortest",
    ]);
    const work = path.join(dir, "cut");
    const r = await renderVideo(src, work, {
      layout: "short",
      fit: "blur",
      segments: [{ start: 1, end: 3 }, { start: 5, end: 8 }],
      hook: { text: "훅", seconds: 1 },
      captions: [{ start: 0.5, end: 1.5, text: "자막" }],
    });
    assert.ok(Math.abs(r.durationSec - 5) < 0.1);
    const out = await probe(path.join(work, "output.mp4"), work);
    assert.ok(Math.abs(out.duration - 5) < 0.3, `got ${out.duration}`);
    assert.equal(out.hasAudio, true);
    assert.deepEqual([out.width, out.height], [1080, 1920]);
  });

  it("cuts a file that has no audio track", async () => {
    const src = make("n.mp4", ["-f", "lavfi", "-i", "testsrc2=s=320x180:r=10:d=5", "-pix_fmt", "yuv420p"]);
    const work = path.join(dir, "cut-na");
    const r = await renderVideo(src, work, { layout: "long", fit: "blur", segments: [{ start: 0, end: 2 }, { start: 3, end: 5 }], captions: [] });
    assert.ok(Math.abs(r.durationSec - 4) < 0.1);
    assert.equal((await probe(path.join(work, "output.mp4"), work)).hasAudio, false);
  });
});
