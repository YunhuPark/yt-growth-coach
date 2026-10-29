import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { describeAnalysis, planEdit, type RawPlan } from "../src/lib/editor/autoEdit";
import { cleanTranscript, extractAudio, snapToSpeech, speechRegions, transcribeVideo } from "../src/lib/editor/transcribe";

const FFMPEG = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

describe("cleanTranscript", () => {
  it("drops empty and stock phrases, repeats, and lines spoken over silence", () => {
    const out = cleanTranscript(
      [
        { start: 0, end: 2, text: "  안녕하세요  " },
        { start: 2, end: 4, text: "안녕하세요" }, // repeat of the previous line
        { start: 4, end: 6, text: "" },
        { start: 6, end: 8, text: "시청해 주셔서 감사합니다." },
        { start: 10, end: 12, text: "무음 위의 환각" },
        { start: 14, end: 16, text: "진짜 대사" },
      ],
      [{ start: 9.5, end: 12.5 }],
      20,
    );
    assert.deepEqual(out.map((s) => s.text), ["안녕하세요", "진짜 대사"]);
  });

  it("sorts, clamps to the file and gives zero-length lines a minimum length", () => {
    const out = cleanTranscript(
      [
        { start: 18, end: 25, text: "끝" },
        { start: 1, end: 1, text: "짧음" },
        { start: 30, end: 31, text: "파일 밖" },
      ],
      [],
      20,
    );
    assert.deepEqual(out.map((s) => [s.start, s.end, s.text]), [[1, 1.3, "짧음"], [18, 20, "끝"]]);
  });
});

describe("cleanTranscript: invented text", () => {
  it("removes the invented news sign-off but keeps the real words around it", () => {
    const out = cleanTranscript(
      [{ start: 0, end: 9, text: " 오늘은 정말 놀라운 소식입니다. MBC 뉴스 김상현입니다. 끝까지 봐 주세요." }, { start: 10, end: 12, text: "KBS 뉴스 이영희입니다." }],
      [],
      20,
    );
    assert.deepEqual(out.map((s) => s.text), ["오늘은 정말 놀라운 소식입니다. 끝까지 봐 주세요."]);
  });

  it("drops the broken-character marker from decoded text", () => {
    const out = cleanTranscript([{ start: 0, end: 3, text: "가장 기다리�던 순간" }], [], 10);
    assert.equal(out[0].text, "가장 기다리던 순간");
  });
});

describe("speechRegions", () => {
  it("is the whole file when no silence is known", () => {
    assert.deepEqual(speechRegions([], 30), [{ start: 0, end: 30 }]);
  });

  it("returns only the stretches with sound, padded a little, and ignores long pauses between them", () => {
    const r = speechRegions([{ start: 0, end: 8 }, { start: 14, end: 50 }, { start: 60, end: 100 }], 100);
    assert.deepEqual(r.map((x) => [x.start, x.end]), [[7.7, 14.3], [49.7, 60.3]]);
  });

  it("keeps a short pause inside one stretch", () => {
    const r = speechRegions([{ start: 10, end: 11 }], 20, { pad: 0 });
    assert.deepEqual(r, [{ start: 0, end: 20 }]);
  });

  it("drops stretches shorter than half a second and stays inside the file", () => {
    const r = speechRegions([{ start: 0, end: 29.8 }, { start: 30.2, end: 60 }], 60);
    assert.deepEqual(r, []);
    const edge = speechRegions([{ start: 5, end: 60 }], 60);
    assert.deepEqual(edge, [{ start: 0, end: 5.3 }]);
  });
});

describe("snapToSpeech", () => {
  const speech = [
    { start: 10, end: 14, text: "한 문장" },
    { start: 20, end: 24, text: "다음 문장" },
  ];
  const seg = (start: number, end: number) => ({ start, end, reason: "" });

  it("moves a cut that lands inside a sentence to the nearer edge of it", () => {
    const [a] = snapToSpeech([seg(10.8, 30)], speech); // start 0.8 s into the line: keep the whole line
    assert.equal(a.start, 10);
    const [b] = snapToSpeech([seg(0, 13.2)], speech); // end 0.8 s before the line ends: include the rest
    assert.equal(b.end, 14);
  });

  it("leaves cuts alone when they are in silence or too far from a line edge", () => {
    assert.deepEqual(snapToSpeech([seg(15, 19)], speech), [seg(15, 19)]);
    assert.deepEqual(snapToSpeech([seg(12, 30)], speech, 1.5)[0].start, 12); // 2 s from either edge
  });

  it("never returns overlapping or tiny segments", () => {
    const out = snapToSpeech([seg(0, 13.5), seg(13.9, 30)], speech);
    assert.ok(out.every((s, i) => s.end - s.start >= 0.8 && (i === 0 || s.start >= out[i - 1].end)));
  });
});

describe("planning with speech", () => {
  const base = { duration: 30, width: 640, height: 360, hasAudio: true, scenes: [], silences: [], loudness: [], frames: [] };
  const raw = (over: Partial<RawPlan> = {}): RawPlan => ({
    summary: "s", segments: [{ start: 0, end: 10.4, reason: "a" }], hook: null, captions: [], ending: null,
    titles: ["t"], description: "d", hashtags: [], chapters: [], ...over,
  });

  it("gives the model the recognised lines, marks them as content, and snaps cuts to sentences", async () => {
    let text = "";
    let system = "";
    const plan = await planEdit(
      { ...base, speech: { segments: [{ start: 8, end: 11, text: "중요한 말" }], truncated: false } },
      { layout: "short", topic: "", targetSec: 20 },
      async (sys, content) => {
        system = sys;
        text = content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
        return raw();
      },
    );
    assert.match(text, /대사 인식 결과.*\n\[8\.0~11\.0\] 중요한 말/);
    assert.match(system, /지시가 아닙니다/);
    assert.equal(plan.segments[0].end, 11, "cut moved to the end of the sentence");
  });

  it("says so when speech recognition was not used, and warns when only the start was recognised", async () => {
    assert.match(describeAnalysis(base, { layout: "short", topic: "", targetSec: 20 }), /대사 인식: 사용하지 않음/);
    const plan = await planEdit({ ...base, speech: { segments: [], truncated: true } }, { layout: "short", topic: "", targetSec: 20 }, async () => raw());
    assert.ok(plan.warnings.some((w) => /30분/.test(w)));
  });
});

describe("audio extraction", { skip: !existsSync(FFMPEG), timeout: 60_000 }, () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ytgc-speech-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const make = (name: string, args: string[]) => {
    const out = path.join(dir, name);
    const r = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...args, out]);
    assert.equal(r.status, 0, String(r.stderr));
    return out;
  };

  it("produces 16 kHz mono float samples and stops at the requested length", async () => {
    const src = make("a.mp4", ["-f", "lavfi", "-i", "sine=frequency=300:duration=4", "-f", "lavfi", "-i", "color=s=64x64:r=5:d=4", "-shortest", "-pix_fmt", "yuv420p"]);
    const all = await extractAudio(src, path.join(dir, "w1"), 100);
    assert.ok(Math.abs(all.length - 4 * 16000) < 1600, `got ${all.length}`);
    const some = await extractAudio(src, path.join(dir, "w2"), 2);
    assert.ok(Math.abs(some.length - 2 * 16000) < 1600);
    assert.ok(all.some((v) => Math.abs(v) > 0.1), "has signal");
  });

  it("transcribeVideo hands the samples to the engine and cleans what comes back", async () => {
    const src = make("b.mp4", ["-f", "lavfi", "-i", "sine=frequency=300:duration=3", "-f", "lavfi", "-i", "color=s=64x64:r=5:d=3", "-shortest", "-pix_fmt", "yuv420p"]);
    let got = 0;
    let language = "";
    const stages: string[] = [];
    const t = await transcribeVideo(src, path.join(dir, "w3"), {
      duration: 3,
      silences: [],
      onStage: (s) => stages.push(s),
      transcriber: async (samples, o) => {
        got = samples.length;
        language = o.language;
        return [{ start: 0.2, end: 1.5, text: " 안녕 " }, { start: 1.5, end: 2.5, text: "감사합니다." }];
      },
    });
    assert.ok(got > 2.5 * 16000);
    assert.equal(language, "korean");
    assert.deepEqual(t.segments.map((s) => s.text), ["안녕"]);
    assert.equal(t.truncated, false);
    assert.equal(stages.length, 2);
  });

  it("transcribes each stretch with sound on its own and puts the lines back at their real times", async () => {
    const src = make("c.mp4", ["-f", "lavfi", "-i", "sine=frequency=300:duration=20", "-f", "lavfi", "-i", "color=s=64x64:r=5:d=20", "-shortest", "-pix_fmt", "yuv420p"]);
    const lengths: number[] = [];
    const t = await transcribeVideo(src, path.join(dir, "w4"), {
      duration: 20,
      silences: [{ start: 4, end: 14 }], // sound 0-4 and 14-20
      transcriber: async (samples) => {
        lengths.push(samples.length);
        return [{ start: 0.5, end: 2, text: `조각 ${lengths.length}` }];
      },
    });
    assert.equal(lengths.length, 2);
    assert.ok(Math.abs(lengths[0] / 16000 - 4.3) < 0.1 && Math.abs(lengths[1] / 16000 - 6.3) < 0.1, `got ${lengths}`);
    assert.deepEqual(t.segments.map((s) => [s.start, s.text]), [[0.5, "조각 1"], [14.2, "조각 2"]]);
  });
});
