"use client";

import { useMemo, useState } from "react";
import type { BeatAnalysis } from "@/lib/editor/beatAnalysis";
import { beatsInResult, beatsWithin, beatTrust, bpmOf, everyNth, planBeatCuts, scaleBeats, shiftBeats, snapToBeats } from "@/lib/editor/beats";
import { CUT_SOUNDS, TRANSITIONS, type CutSound, type TransitionKind } from "@/lib/editor/effects";
import { parseNumber } from "@/lib/editor/retention";
import { useReframeOption } from "./framingContext";
import { followRender, MadeResult, runningLabel, wait, type Made } from "./madeRender";
import { api } from "../shared";
import { sourceReady, type SourceState } from "./source";
import ToolIntro from "./ToolIntro";

type AutoStatus = { status: "running" | "done" | "error"; stage: string; error?: string; beats?: BeatAnalysis };
type Scale = "same" | "double" | "half";

/** A render this long or longer is refused for a short, and the effect list would be cut off anyway. */
const MAX_LENGTH_SEC = 180;
/** How much sound is listened to at most (the server's limit); a montage can draw on all of it. */
const MAX_ANALYSIS_SEC = 600;
const TARGETS = [15, 30, 45, 60];
const TEST_SEC = 15;
const clock = (sec: number) => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, "0")}`;

/** What the beats' evenness and onset support say about how far to trust them. */
function trust(regularity: number, support: number): { label: string; cls: string; advice: string } {
  const t = beatTrust(regularity, support);
  if (t === "high") return { label: "박자가 뚜렷함", cls: "chip-local", advice: "" };
  if (t === "medium") return { label: "조금 불확실", cls: "chip", advice: "박자가 고르지 않거나 실제 소리와 맞는 정도가 낮습니다. 먼저 15초만 만들어 확인해 보세요." };
  return { label: "불확실", cls: "rounded-md bg-bad/15 px-2 py-0.5 text-xs font-semibold text-bad", advice: "박자가 뚜렷하지 않은 소리(말소리가 큰 영상, 박자가 자유로운 음악)라 효과가 어긋날 가능성이 큽니다." };
}

/**
 * Puts a flash, a zoom or a tick on every beat of the music in a video. The sound is listened to once on this computer; what the
 * beats are (double or half the tempo, shifted, every second or fourth) is worked out on the page, so those controls answer at once.
 */
export default function BeatSync({ source }: { source: SourceState }) {
  const follow = useReframeOption("short");
  const [startText, setStartText] = useState("0");
  const [lengthText, setLengthText] = useState("60");
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<BeatAnalysis | null>(null);
  const [scale, setScale] = useState<Scale>("same");
  const [offsetMs, setOffsetMs] = useState(0);
  const [every, setEvery] = useState(1);
  const [phase, setPhase] = useState(0);
  const [snap, setSnap] = useState(true);
  const [mode, setMode] = useState<"whole" | "montage">("whole");
  const [piece, setPiece] = useState(4);
  const [target, setTarget] = useState(30);
  const [pickBy, setPickBy] = useState<"even" | "loud">("even");
  const [transition, setTransition] = useState<TransitionKind>("flash");
  const [sound, setSound] = useState<CutSound>("tick");
  const [volume, setVolume] = useState(0.6);
  const [layout, setLayout] = useState<"short" | "long">("short");
  const [made, setMade] = useState<Record<string, Made>>({});

  const analyzing = stage !== null;
  const ready = sourceReady(source) && !analyzing;

  // the beats with tempo and offset applied; "every Nth" is applied after, on the beats of the result
  const base = useMemo(() => (found ? shiftBeats(scaleBeats(found.beats, scale), offsetMs / 1000) : []), [found, scale, offsetMs]);
  const beats = useMemo(() => everyNth(base, every, Math.min(phase, every - 1)), [base, every, phase]);

  // a montage: pieces of whole bars from all over the stretch, joined
  const pieces = useMemo(() => (found && mode === "montage" ? planBeatCuts(base, found.fromSec, found.fromSec + found.analyzedSec, piece, target, pickBy === "loud" ? { by: "loud", loudness: found.loudness } : { by: "even" }) : []), [found, mode, base, piece, target, pickBy]);
  const montageTimes = useMemo(() => everyNth(beatsInResult(pieces, base), every, Math.min(phase, every - 1)), [pieces, base, every, phase]);
  const montageSec = pieces.reduce((n, p) => n + (p.end - p.start), 0);

  const range = useMemo(() => {
    if (!found) return null;
    const from = found.fromSec;
    const to = from + found.analyzedSec;
    const r = snap && beats.length >= 3 ? snapToBeats(from, to, beats) : { start: from, end: to, beats: beatsWithin(beats, from, to).length - 1 };
    const end = Math.min(r.end, r.start + MAX_LENGTH_SEC);
    return { start: r.start, end, beats: r.beats };
  }, [found, beats, snap]);

  const wholeTimes = useMemo(() => (range ? beatsWithin(beats, range.start, range.end) : []), [beats, range]);
  const montage = mode === "montage";
  const times = montage ? montageTimes : wholeTimes;
  const outSec = montage ? montageSec : range ? range.end - range.start : 0;
  const hasEffect = transition !== "none" || sound !== "none";

  const analyze = async () => {
    setError(null);
    setFound(null);
    setMade({});
    setScale("same");
    setOffsetMs(0);
    setEvery(1);
    setPhase(0);
    const start = parseNumber(startText);
    const length = parseNumber(lengthText);
    if (start === null || start < 0 || length === null || length < 4) {
      setError("시작과 길이는 초(예: 30) 또는 분:초(예: 1:30)로 적어 주세요. 길이는 4초 이상이어야 합니다.");
      return;
    }
    setStage("올리는 중");
    try {
      const fd = new FormData();
      if (source.file) fd.append("file", source.file);
      fd.append(
        "options",
        JSON.stringify({ startSec: start, lengthSec: Math.min(length, MAX_ANALYSIS_SEC), sourcePath: !source.file && source.sourcePath.trim() ? source.sourcePath.trim() : undefined, rights: { confirmed: true, basis: source.basis } }),
      );
      const res = await fetch("/api/beats", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `분석 실패 (${res.status})`);
      for (;;) {
        await wait(1000);
        const st = await api<AutoStatus>(`/api/autoedit/status?id=${json.id}`);
        setStage(st.stage);
        if (st.status === "error") throw new Error(st.error ?? "분석에 실패했습니다.");
        if (st.status === "done" && st.beats) {
          if (st.beats.beats.length < 3) throw new Error("이 구간에서는 박자를 찾지 못했습니다. 음악이 또렷하게 들리는 구간을 골라 보세요.");
          setFound(st.beats);
          break;
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStage(null);
    }
  };

  const make = async (key: string, seconds: number | null) => {
    if (!range) return;
    let segments: { start: number; end: number }[];
    let beatTimes: number[];
    if (montage) {
      // the test takes as many pieces from the front as fit in its length
      let n = pieces.length;
      if (seconds !== null) {
        let sum = 0;
        n = pieces.filter((p) => (sum += p.end - p.start) - (p.end - p.start) < seconds).length;
      }
      segments = pieces.slice(0, Math.max(1, n));
      beatTimes = everyNth(beatsInResult(segments, base), every, Math.min(phase, every - 1));
    } else {
      const end = seconds === null ? range.end : Math.min(range.end, range.start + seconds);
      segments = [{ start: range.start, end }];
      beatTimes = beatsWithin(beats, range.start, end);
    }
    if (!segments.length) return;
    const fd = new FormData();
    if (source.file) fd.append("file", source.file);
    fd.append(
      "options",
      JSON.stringify({
        layout,
        fit: "blur",
        captions: [],
        segments,
        reframe: layout === "short" ? follow : undefined,
        effects: { transition, cutSound: sound, volume, beatTimes },
        sourcePath: !source.file && source.sourcePath.trim() ? source.sourcePath.trim() : undefined,
        rights: { confirmed: true, basis: source.basis },
      }),
    );
    await followRender(fd, (m) => setMade((cur) => ({ ...cur, [key]: { ...({ state: "running", progress: 0 } as Made), ...cur[key], ...m } })));
  };

  const t = found ? trust(found.regularity, found.support) : null;
  const busy = made.test?.state === "running" || made.full?.state === "running";

  return (
    <section className="card flex flex-col gap-5">
      <ToolIntro
        icon="wave"
        title="박자에 맞춰 효과 넣기"
        summary="영상 속 음악의 박자를 찾아서, 박자마다 번쩍임·확대·효과음을 넣은 영상을 만듭니다."
        steps={["음악이 잘 들리는 구간(시작과 길이)을 정해 ‘박자 찾기’를 누릅니다", "박자가 맞는지 보고, 어긋나면 2배·절반·위치 조절로 맞춥니다", "그대로 쓸지 박에 맞춰 줄일지 고르고, 15초만 먼저 만들어 확인한 뒤 전체를 만듭니다"]}
        uses="local"
      >
        소리를 내 컴퓨터에서 분석하며 영상이나 소리는 어디로도 전송되지 않고 AI도 쓰지 않습니다. 박자 찾기는 MIT 라이선스의 music-tempo 패키지(BeatRoot 알고리즘)를 쓰며 1분에 60~200박 사이의 박자만 찾습니다.
        음악이 또렷하고 박자가 일정한 영상에서 잘 맞고, 말소리가 큰 영상이나 박자가 자유로운 곡에서는 어긋납니다. 템포를 절반이나 두 배로 잘못 잡는 일이 흔해서 ‘2배·절반’ 단추와 위치 조절을 두었습니다. 합성한 북소리와 박이 뚜렷한 전자음악 2곡으로만 시험했고, 박이 약한 곡이나 사람 목소리가 섞인 영상은 시험하지 못했습니다.
        효과는 한 번에 최대 400개(번쩍임·어두워짐은 150개, 확대는 100개)까지 넣고, 그대로 만들 때는 최대 3분까지 만듭니다. ‘박에 맞춰 줄이기’는 한 번에 최대 10분 구간에서 4박이나 8박 조각을 고르게 뽑아 이어 붙이는데, 조각이 박에서 시작해 박에서 끝나 이어 붙여도 박자가 그대로 이어집니다. 조각은 구간 전체에서 고르게 뽑거나 소리가 큰 곳 위주로 뽑는데, 큰 소리가 꼭 좋은 장면은 아니고 장면(화면)은 보지 않습니다. 소리가 큰 곳 위주로 뽑으면 한곳에 몰릴 수 있습니다.
      </ToolIntro>

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <label className="field">시작 (예: 30 또는 0:30)
          <input className="input" value={startText} onChange={(e) => setStartText(e.target.value)} inputMode="text" />
        </label>
        <label className="field">길이 (4초~10분)
          <input className="input" value={lengthText} onChange={(e) => setLengthText(e.target.value)} inputMode="text" />
        </label>
        <button className="btn-primary self-end" onClick={analyze} disabled={!ready}>{analyzing ? `${stage}…` : "박자 찾기"}</button>
      </div>
      {!sourceReady(source) && <p className="callout text-sm text-muted">앞 단계에서 영상을 올리고 권리 확인을 마치면 박자를 찾을 수 있어요.</p>}
      {error && <p className="rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad" role="alert">{error}</p>}

      {found && range && t && (
        <div className="flex flex-col gap-5 border-t border-line pt-5">
          <dl className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
            <div className="bg-card p-4">
              <dt className="text-xs font-medium text-muted">찾은 박자</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums">{bpmOf(beats)} BPM</dd>
            </div>
            <div className="bg-card p-4">
              <dt className="text-xs font-medium text-muted">고르기</dt>
              <dd className="mt-1"><span className={t.cls}>{t.label}</span></dd>
            </div>
            <div className="bg-card p-4">
              <dt className="text-xs font-medium text-muted">효과가 들어갈 곳</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums">{times.length}곳 <span className="text-sm font-medium text-muted">· 결과 약 {Math.round(outSec)}초</span></dd>
            </div>
          </dl>
          {t.advice && <p className="callout text-sm">{t.advice}</p>}

          <BeatStrip times={times} length={outSec} />

          <fieldset className="flex flex-col gap-3">
            <legend className="font-bold">만드는 방식</legend>
            <div className="flex flex-wrap gap-2">
              {([["whole", "구간 그대로"], ["montage", "박에 맞춰 줄이기 (조각 이어 붙이기)"]] as const).map(([id, label]) => (
                <label key={id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${mode === id ? "border-foreground bg-foreground/[0.04]" : "border-line"}`}>
                  <input type="radio" name="beat-mode" checked={mode === id} onChange={() => setMode(id)} />
                  {label}
                </label>
              ))}
            </div>
            {montage && (
              <div className="flex flex-wrap items-end gap-3">
                <label className="field">조각 길이
                  <select className="input w-auto" value={piece} onChange={(e) => setPiece(Number(e.target.value))}>
                    <option value={4}>4박 (한 마디)</option>
                    <option value={8}>8박 (두 마디)</option>
                  </select>
                </label>
                <label className="field">결과 길이(목표)
                  <select className="input w-auto" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
                    {TARGETS.map((n) => <option key={n} value={n}>약 {n}초</option>)}
                  </select>
                </label>
                <label className="field">뽑는 방식
                  <select className="input w-auto" value={pickBy} onChange={(e) => setPickBy(e.target.value as "even" | "loud")}>
                    <option value="even">구간 전체에서 고르게</option>
                    <option value="loud">소리가 큰 곳 위주</option>
                  </select>
                </label>
                <p className="text-sm text-muted">{pieces.length ? `${pieces.length}개 조각을 이어 붙입니다.` : "조각을 만들 박이 모자랍니다. 더 긴 구간을 분석해 보세요."}</p>
              </div>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="font-bold">박자 맞추기</legend>
            <div className="flex flex-wrap items-end gap-3">
              <div className="field">템포
                <div className="flex gap-2">
                  {([["half", "절반으로"], ["same", "그대로"], ["double", "2배로"]] as const).map(([id, label]) => (
                    <button key={id} className="btn" aria-pressed={scale === id} onClick={() => setScale(id)} style={scale === id ? { borderColor: "var(--foreground)", fontWeight: 700 } : undefined}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="field">몇 박마다
                <select className="input w-auto" value={every} onChange={(e) => { setEvery(Number(e.target.value)); setPhase(0); }}>
                  <option value={1}>모든 박</option>
                  <option value={2}>2박마다</option>
                  <option value={4}>4박마다 (한 마디)</option>
                </select>
              </label>
              {every > 1 && (
                <label className="field">어느 박부터
                  <select className="input w-auto" value={phase} onChange={(e) => setPhase(Number(e.target.value))}>
                    {Array.from({ length: every }, (_, i) => <option key={i} value={i}>{i + 1}번째 박</option>)}
                  </select>
                </label>
              )}
            </div>
            <label className="field max-w-md">위치 미세 조절: {offsetMs > 0 ? "+" : ""}{offsetMs}ms {offsetMs < 0 ? "(더 일찍)" : offsetMs > 0 ? "(더 늦게)" : ""}
              <input type="range" min={-250} max={250} step={10} value={offsetMs} onChange={(e) => setOffsetMs(Number(e.target.value))} />
            </label>
            {!montage && (
              <label className="text-sm">
                <input type="checkbox" className="mr-2" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
                시작과 끝을 박자에 맞춰 자르기 <span className="text-muted">({clock(range.start)} ~ {clock(range.end)}, {Math.max(0, range.beats)}박)</span>
              </label>
            )}
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-2 font-bold">넣을 효과</legend>
            <label className="field">화면
              <select className="input" value={transition} onChange={(e) => setTransition(e.target.value as TransitionKind)}>
                {TRANSITIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            <label className="field">소리
              <select className="input" value={sound} onChange={(e) => setSound(e.target.value as CutSound)}>
                {CUT_SOUNDS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            <label className="field">효과음 크기 {Math.round(volume * 100)}%
              <input type="range" min={0.1} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} disabled={sound === "none"} />
            </label>
          </fieldset>

          <div className="flex flex-wrap items-end gap-3">
            <label className="field">결과 형식
              <select className="input w-auto" value={layout} onChange={(e) => setLayout(e.target.value as "short" | "long")}>
                <option value="short">세로 쇼츠 1080×1920</option>
                <option value="long">가로 1920×1080</option>
              </select>
            </label>
            <button className="btn" disabled={!hasEffect || busy || !sourceReady(source) || (montage && !pieces.length)} onClick={() => void make("test", TEST_SEC)}>
              {runningLabel(made.test, `먼저 ${TEST_SEC}초만 만들어 보기`)}
            </button>
            <button className="btn-primary" disabled={!hasEffect || busy || !sourceReady(source) || (montage && !pieces.length)} onClick={() => void make("full", null)}>
              {runningLabel(made.full, "전체 만들기")}
            </button>
          </div>
          {!hasEffect && <p className="text-sm text-muted">화면이나 소리 효과를 하나 이상 골라 주세요.</p>}
          <MadeResult job={made.test} />
          <MadeResult job={made.full} />
        </div>
      )}
    </section>
  );
}

/** The beats along the stretch as ticks, so a wrong tempo or phase can be seen before anything is made. */
function BeatStrip({ times, length }: { times: number[]; length: number }) {
  const W = 640;
  const H = 36;
  const X = (s: number) => 4 + (s / Math.max(0.1, length)) * (W - 8);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-line bg-card" role="img" aria-label={`효과가 들어갈 ${times.length}곳을 ${Math.round(length)}초 길이 위에 나타낸 그림`}>
        {times.map((s, i) => (
          <line key={i} x1={X(s)} x2={X(s)} y1={6} y2={H - 6} stroke="currentColor" strokeWidth={times.length > 150 ? 1 : 2} opacity={0.75} />
        ))}
      </svg>
      <figcaption className="mt-1.5 text-xs text-muted">세로 선 하나가 효과 하나입니다. 음악의 박과 겹치지 않아 보이면 ‘어느 박부터’나 위치 조절을 써 보세요.</figcaption>
    </figure>
  );
}
