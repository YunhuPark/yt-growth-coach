"use client";

import { useEffect, useMemo, useState } from "react";
import { parseCues, parseNumber, parseRetention, readRetention, saidAt, type Curve, type Reading, type Span } from "@/lib/retention";
import { keepSegments } from "@/lib/cutPlan";
import { DEMO } from "@/lib/demo";
import { previewRange, removalsFromCliffs, shortFromRewatch, SHORT_LENGTHS } from "@/lib/retentionActions";
import { useCaptionStyle } from "./captionStyleContext";
import { useEffectsOption } from "./effectsContext";
import { useReframeOption } from "./framingContext";
import RangePreview from "./RangePreview";
import { api } from "./shared";
import { sourceReady, type SourceState } from "./source";
import ToolIntro from "./ToolIntro";

type Unit = "auto" | "percent" | "seconds";

/** A made-up curve for trying the tool out: a leaky opening, one steep drop and a stretch where viewers come back. */
function sample(): string {
  const rows = ["영상 위치(%),시청 지속률(%)"];
  for (let p = 0; p <= 100; p++) {
    let y = p <= 8 ? 100 - 4.2 * p : 66 - 0.33 * (p - 8);
    if (p > 47) y -= p > 48 ? 11 : 5; // a steep drop
    if (p > 72) y += p > 74 ? 5 : (p - 72) * 2.5; // people come back
    rows.push(`${p},${y.toFixed(1)}`);
  }
  return rows.join("\n");
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
/** "5:20 ~ 5:40", or "영상의 48~50%" without the length. */
const range = (s: Span) => (s.fromSec !== null && s.toSec !== null ? `${clock(s.fromSec)} ~ ${clock(s.toSec)}` : `영상의 ${Math.round(s.fromPct)}~${Math.round(s.toPct)}%`);

const VERDICT: Record<Reading["hookVerdict"], { label: string; cls: string }> = {
  healthy: { label: "무난함", cls: "chip-local" },
  leaking: { label: "새는 중", cls: "chip" },
  severe: { label: "심각", cls: "rounded-md bg-bad/15 px-2 py-0.5 text-xs font-semibold text-bad" },
};

/**
 * Reads a YouTube Studio audience-retention export: the one thing the analytics page says about where viewers leave. Everything is
 * worked out on this page from what was pasted; nothing is sent anywhere and no AI is used.
 */
type Made = { state: "running" | "done" | "error"; progress: number; stage?: string; id?: string; durationSec?: number; bytes?: number; error?: string; note?: string };
type RenderStatus = { status: "running" | "done" | "error"; progress: number; stage?: string; note?: string; error?: string; result?: { durationSec: number; bytes: number } };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function RetentionTool({ source }: { source: SourceState }) {
  const [text, setText] = useState("");
  const [unit, setUnit] = useState<Unit>("auto");
  const [length, setLength] = useState("");
  const [srt, setSrt] = useState("");
  const [shown, setShown] = useState<{ curve: Curve; reading: Reading; durationSec: number | null; cues: ReturnType<typeof parseCues>; isSample: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { style } = useCaptionStyle();
  const effects = useEffectsOption();
  const follow = useReframeOption("short");
  const [made, setMade] = useState<Record<string, Made>>({});
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [layout, setLayout] = useState<"long" | "short">("long");
  const [shortLen, setShortLen] = useState<number>(30);
  const videoReady = sourceReady(source);

  // An uploaded file tells its own length, so the page need not ask for it.
  useEffect(() => {
    if (!source.file) return;
    const url = URL.createObjectURL(source.file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) setLength((cur) => (cur.trim() ? cur : String(Math.round(v.duration))));
      URL.revokeObjectURL(url);
    };
    v.src = url;
    return () => URL.revokeObjectURL(url);
  }, [source.file]);

  const patch = (key: string, m: Partial<Made>) => setMade((cur) => ({ ...cur, [key]: { ...({ state: "running", progress: 0 } as Made), ...cur[key], ...m } }));

  /** Renders the video with the given options and follows it until it is done. */
  const make = async (key: string, options: object) => {
    patch(key, { state: "running", progress: 0, error: undefined, id: undefined, note: undefined, stage: undefined });
    try {
      const fd = new FormData();
      if (source.file) fd.append("file", source.file);
      fd.append(
        "options",
        JSON.stringify({ ...options, fit: "blur", captions: [], style, effects, sourcePath: !source.file && source.sourcePath.trim() ? source.sourcePath.trim() : undefined, rights: { confirmed: true, basis: source.basis } }),
      );
      const res = await fetch("/api/render", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `렌더링 실패 (${res.status})`);
      for (;;) {
        await wait(1000);
        const st = await api<RenderStatus>(`/api/render/status?id=${json.id}`);
        patch(key, { progress: st.progress, stage: st.stage });
        if (st.status === "error") throw new Error(st.error ?? "렌더링에 실패했습니다.");
        if (st.status === "done" && st.result) {
          patch(key, { state: "done", progress: 1, stage: undefined, id: json.id, durationSec: st.result.durationSec, bytes: st.result.bytes, note: st.note });
          return;
        }
      }
    } catch (e) {
      patch(key, { state: "error", error: (e as Error).message });
    }
  };

  const analyze = (source = text, isSample = false) => {
    setError(null);
    setCopied(false);
    const parsed = parseRetention(source, unit);
    if (!parsed.ok) {
      setShown(null);
      setError(parsed.error);
      return;
    }
    const typed = length.trim() ? parseNumber(length) : null;
    if (length.trim() && (typed === null || typed <= 0)) {
      setShown(null);
      setError("영상 길이는 초(예: 600) 또는 분:초(예: 10:00)로 적어 주세요.");
      return;
    }
    const cues = srt.trim() ? parseCues(srt) : [];
    setShown({ curve: parsed.curve, reading: readRetention(parsed.curve, typed), durationSec: typed, cues, isSample });
  };

  const r = shown?.reading;
  const summary = useMemo(() => (r ? summaryText(r, shown?.cues ?? []) : ""), [r, shown?.cues]);

  return (
    <section className="card flex flex-col gap-5">
      <ToolIntro
        icon="chart"
        title="시청 지속 분석"
        summary="YouTube Studio의 시청 지속률 데이터를 붙이면, 시청자가 어디서 떠나는지 찾아서 가장 먼저 손볼 곳 하나를 알려 줍니다."
        steps={["Studio에서 시청 지속률 데이터를 내려받아 붙여 넣습니다", "영상 길이(선택)와 자막(선택)을 넣고 ‘분석하기’를 누릅니다", "가장 큰 문제 하나와 이탈 구간을 확인합니다"]}
        uses="local"
      >
        내려받는 곳: YouTube Studio → 분석 → 영상 하나 선택 → 참여도 → 시청 지속률 그래프 → 다운로드 아이콘 → “시청 지속률” 파일(CSV). 위치와 지속률 두 열이 있는 파일이면 되고, 파일을
        열어 내용을 그대로 붙여 넣으면 됩니다. 계산은 모두 이 화면 안에서 하며 데이터는 어디로도 전송되지 않고 AI도 쓰지 않습니다. 이 분석은 곡선 모양만 보는 것이라 “왜” 떠났는지는 알려 주지
        못합니다. 영상 길이와 자막(SRT)을 넣으면 그 순간에 무슨 말을 하고 있었는지 함께 보여 줍니다. 도입 이탈 기준(25%p, 40%p)과 급락·완만한 하락 기준은 경험칙이므로, 같은 채널의 다른
        영상과 비교해서 보세요. 아이디어(도입·급락·완만한 하락으로 나눠 보기)는 MIT 라이선스의 youtube-agent-skill을 참고했고 코드는 새로 작성했습니다.
      </ToolIntro>

      <div className="flex flex-col gap-3">
        <label className="field">시청 지속률 데이터 (CSV를 열어 붙여 넣기)
          <textarea
            className="input min-h-40 font-mono text-xs"
            placeholder={"영상 위치(%),시청 지속률(%)\n0,100\n1,97.4\n2,93.1\n…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="field">첫 열의 단위
            <select className="input" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              <option value="auto">자동 (보통은 이대로)</option>
              <option value="percent">영상의 퍼센트(%)</option>
              <option value="seconds">초</option>
            </select>
          </label>
          <label className="field">영상 길이 (선택, 예: 600 또는 10:00)
            <input className="input" inputMode="text" placeholder="비우면 퍼센트로만 말해요" value={length} onChange={(e) => setLength(e.target.value)} />
          </label>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted hover:text-foreground">자막(SRT)도 넣기 (선택): 급락한 순간에 무슨 말을 했는지 보여 줍니다</summary>
          <label className="field mt-2">SRT 자막 내용 (영상 길이도 함께 넣어야 합니다)
            <textarea className="input min-h-28 font-mono text-xs" value={srt} onChange={(e) => setSrt(e.target.value)} spellCheck={false} />
          </label>
        </details>
        {error && <p className="rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad" role="alert">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={() => analyze()} disabled={!text.trim()}>분석하기</button>
          <button
            className="btn"
            onClick={() => {
              const s = sample();
              setText(s);
              analyze(s, true);
            }}
          >
            예시 데이터로 해 보기
          </button>
        </div>
      </div>

      {shown && r && (
        <div className="flex flex-col gap-6 border-t border-line pt-6">
          {shown.isSample && <p className="callout text-xs text-muted">지금 보는 것은 예시용으로 만든 가짜 데이터입니다. 내 영상의 데이터를 붙여 넣고 다시 분석해 보세요.</p>}

          <div className="rounded-[10px] border-2 border-foreground p-5">
            <p className="timecode !text-foreground">가장 먼저 볼 것</p>
            <h3 className="mt-2 text-2xl font-bold">{r.main.title}</h3>
            <p className="mt-2 text-muted">{r.main.advice}</p>
          </div>

          <Chart curve={shown.curve} reading={r} />

          <dl className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
            <div className="bg-card p-4">
              <dt className="text-xs font-medium text-muted">처음 → 끝 지속률</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums">{r.start}% → {r.end}%</dd>
            </div>
            <div className="bg-card p-4">
              <dt className="text-xs font-medium text-muted">도입 이탈 ({r.hookWindow.sec !== null ? `처음 ${Math.round(r.hookWindow.sec)}초` : `처음 ${r.hookWindow.pct}%`})</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2 text-xl font-bold tabular-nums">
                {r.hookLeak}%p <span className={VERDICT[r.hookVerdict].cls}>{VERDICT[r.hookVerdict].label}</span>
              </dd>
            </div>
            <div className="bg-card p-4">
              <dt className="text-xs font-medium text-muted">중간의 꾸준한 하락</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums">
                {r.slidePerMin !== null ? `1분에 ${r.slidePerMin}%p` : `10%마다 ${r.slidePer10Pct}%p`}
              </dd>
            </div>
          </dl>

          <div>
            <h3 className="font-bold">급락한 곳 {r.cliffs.length ? `${r.cliffs.length}곳` : ""}</h3>
            {r.cliffs.length === 0 ? (
              <p className="mt-2 text-sm text-muted">뚜렷한 급락이 없습니다. 떠나는 이유가 한 순간이 아니라 전체 템포에 있을 가능성이 큽니다.</p>
            ) : (
              <ol className="mt-2 divide-y divide-line border-y border-line">
                {r.cliffs.map((c, i) => {
                  const said = c.fromSec !== null && c.toSec !== null ? saidAt(shown.cues, c.fromSec, c.toSec) : "";
                  return (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3 text-sm">
                      <span className="font-mono text-xs font-bold">#{i + 1}</span>
                      <span className="font-semibold">{range(c)}</span>
                      <span className="tabular-nums text-bad">−{c.points}%p</span>
                      {shown.cues.length > 0 && <span className="w-full text-muted sm:w-auto sm:flex-1">{said ? `“${said}”` : c.fromSec === null ? "영상 길이를 넣으면 이 순간의 말을 보여 줍니다" : "이 근처에는 자막이 없습니다"}</span>}
                      {videoReady && previewRange(c, r.durationSec) && (
                        <span className="ml-auto">
                          <RangePreview file={source.file} sourcePath={source.sourcePath.trim()} start={previewRange(c, r.durationSec)!.start} end={previewRange(c, r.durationSec)!.end} basis={source.basis} label="▶ 앞뒤 3초 보기" />
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {r.rewatches.length > 0 && (
            <div>
              <h3 className="font-bold">다시 돌려 본 곳 {r.rewatches.length}곳</h3>
              <p className="mt-1 text-sm text-muted">지속률이 오른 구간입니다. 시청자가 되돌려 다시 본 순간이라 쇼츠로 잘라 내기 좋은 후보입니다.</p>
              <ol className="mt-2 divide-y divide-line border-y border-line">
                {r.rewatches.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-4 py-3 text-sm">
                    <span className="font-mono text-xs font-bold">#{i + 1}</span>
                    <span className="font-semibold">{range(c)}</span>
                    <span className="tabular-nums text-good">+{c.points}%p</span>
                    {shown.cues.length > 0 && c.fromSec !== null && c.toSec !== null && <span className="w-full text-muted sm:w-auto sm:flex-1">“{saidAt(shown.cues, c.fromSec, c.toSec) || "…"}”</span>}
                    {videoReady && shortFromRewatch(c, r.durationSec, shortLen) && (
                      <span className="ml-auto flex flex-wrap items-center gap-2">
                        <RangePreview file={source.file} sourcePath={source.sourcePath.trim()} start={previewRange(c, r.durationSec)!.start} end={previewRange(c, r.durationSec)!.end} basis={source.basis} label="▶ 보기" />
                        <button
                          className="btn"
                          disabled={made[`rewatch:${i}`]?.state === "running"}
                          onClick={() => {
                            const seg = shortFromRewatch(c, r.durationSec, shortLen)!;
                            void make(`rewatch:${i}`, { layout: "short", segments: [seg], reframe: follow });
                          }}
                        >
                          {made[`rewatch:${i}`]?.state === "running" ? (made[`rewatch:${i}`]?.stage ? `${made[`rewatch:${i}`]?.stage}…` : `만드는 중… ${Math.round(made[`rewatch:${i}`]!.progress * 100)}%`) : `이 구간으로 ${shortLen}초 쇼츠 만들기`}
                        </button>
                      </span>
                    )}
                    <MadeResult job={made[`rewatch:${i}`]} />
                  </li>
                ))}
              </ol>
              {videoReady && r.durationSec !== null && (
                <label className="field mt-3 w-fit">쇼츠 길이
                  <select className="input w-auto" value={shortLen} onChange={(e) => setShortLen(Number(e.target.value))}>
                    {SHORT_LENGTHS.map((n) => <option key={n} value={n}>{n}초</option>)}
                  </select>
                </label>
              )}
            </div>
          )}

          {!DEMO && !videoReady && (r.cliffs.length > 0 || r.rewatches.length > 0) && (
            <p className="callout text-sm text-muted">영상 파일을 올리면(앞 단계) 이 구간들을 바로 재생해 보고, 급락 구간을 뺀 영상이나 다시 돌려 본 구간의 쇼츠를 만들 수 있어요. 영상 길이도 알아야 하니 위에서 함께 넣어 주세요.</p>
          )}
          {!DEMO && videoReady && r.durationSec === null && (r.cliffs.length > 0 || r.rewatches.length > 0) && (
            <p className="callout text-sm text-muted">영상 길이(예: 600 또는 10:00)를 넣고 다시 분석하면 구간을 재생하고 영상을 만들 수 있어요. 파일을 직접 올리면 길이가 자동으로 들어갑니다.</p>
          )}
          {videoReady && r.durationSec !== null && r.cliffs.length > 0 && (
            <div>
              <h3 className="font-bold">급락한 곳을 빼고 다시 만들기</h3>
              <p className="mt-1 text-sm text-muted">시청자가 한꺼번에 빠진 곳을 잘라 낸 시험용 편집본입니다. 급락의 원인이 그 장면 자체가 아닐 수도 있으니, 앞뒤를 재생해 본 뒤 빼고 싶은 곳만 고르세요.</p>
              <ul className="mt-2 flex flex-col gap-1">
                {r.cliffs.map((c, i) => (
                  <li key={i}>
                    <label className="text-sm">
                      <input
                        type="checkbox"
                        className="mr-2"
                        checked={!skip.has(i)}
                        onChange={() => setSkip((cur) => {
                          const next = new Set(cur);
                          if (next.has(i)) next.delete(i);
                          else next.add(i);
                          return next;
                        })}
                      />
                      #{i + 1} {range(c)} 빼기 <span className="text-muted">(−{c.points}%p)</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="field">결과 형식
                  <select className="input w-auto" value={layout} onChange={(e) => setLayout(e.target.value as "long" | "short")}>
                    <option value="long">가로 1920×1080</option>
                    <option value="short">세로 쇼츠 1080×1920 (3분 이하)</option>
                  </select>
                </label>
                <button
                  className="btn-primary self-end"
                  disabled={made["cut"]?.state === "running" || r.cliffs.every((_, i) => skip.has(i))}
                  onClick={() => {
                    const removals = removalsFromCliffs(r.cliffs.filter((_, i) => !skip.has(i)), r.durationSec);
                    const segments = keepSegments(r.durationSec!, removals);
                    void make("cut", { layout, segments, reframe: layout === "short" ? follow : undefined });
                  }}
                >
                  {made["cut"]?.state === "running" ? (made["cut"]?.stage ? `${made["cut"]?.stage}…` : `만드는 중… ${Math.round(made["cut"]!.progress * 100)}%`) : "이 편집본 만들기"}
                </button>
              </div>
              <MadeResult job={made["cut"]} />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="btn"
              onClick={() => {
                navigator.clipboard?.writeText(summary).then(() => setCopied(true), () => {});
              }}
            >
              결과 글로 복사
            </button>
            {copied && <span role="status" className="text-sm text-muted">복사했습니다</span>}
          </div>
        </div>
      )}
    </section>
  );
}

/** The retention curve with the opening shaded, each steep drop numbered and each place viewers came back marked. */
function Chart({ curve, reading }: { curve: Curve; reading: Reading }) {
  const W = 640;
  const H = 220;
  const pad = { l: 34, r: 8, t: 8, b: 22 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x0 = curve.points[0].x;
  const span = curve.points[curve.points.length - 1].x - x0 || 1;
  const maxY = Math.max(100, ...curve.points.map((p) => p.y));
  const X = (pct: number) => pad.l + (pct / 100) * iw;
  const Y = (v: number) => pad.t + (1 - v / maxY) * ih;
  const line = curve.points.map((p) => `${X(((p.x - x0) / span) * 100).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const ticks = [0, 25, 50, 75, 100];
  const label = (pct: number) => (reading.durationSec !== null ? clock((pct / 100) * reading.durationSec) : `${pct}%`);

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-line bg-card" role="img" aria-label={`시청 지속률 그래프. ${reading.start}%에서 시작해 ${reading.end}%로 끝납니다. 급락 ${reading.cliffs.length}곳.`}>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={Y(v)} y2={Y(v)} stroke="currentColor" opacity={0.12} />
            <text x={pad.l - 6} y={Y(v) + 4} textAnchor="end" fontSize="10" fill="currentColor" opacity={0.6}>{v}%</text>
          </g>
        ))}
        <rect x={X(0)} y={pad.t} width={X(reading.hookWindow.pct) - X(0)} height={ih} fill="currentColor" opacity={0.07} />
        {reading.cliffs.map((c, i) => (
          <g key={`c${i}`}>
            <rect x={X(c.fromPct)} y={pad.t} width={Math.max(3, X(c.toPct) - X(c.fromPct))} height={ih} fill="var(--bad)" opacity={0.18} />
            <text x={X(c.fromPct)} y={pad.t + 10} fontSize="10" fontWeight="700" fill="var(--bad)">#{i + 1}</text>
          </g>
        ))}
        {reading.rewatches.map((c, i) => (
          <path key={`r${i}`} d={`M${X((c.fromPct + c.toPct) / 2)} ${H - pad.b - 2} l-4 7 h8 Z`} fill="var(--good)" />
        ))}
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
        {ticks.map((t) => (
          <text key={t} x={X(t)} y={H - 4} textAnchor={t === 0 ? "start" : t === 100 ? "end" : "middle"} fontSize="10" fill="currentColor" opacity={0.6}>{label(t)}</text>
        ))}
      </svg>
      <figcaption className="mt-1.5 text-xs text-muted">회색 띠는 도입 구간, 붉은 띠는 급락(번호는 아래 목록), 초록 ▲는 다시 돌려 본 곳입니다.</figcaption>
    </figure>
  );
}

/** The reading as plain text, for pasting into notes. */
function summaryText(r: Reading, cues: ReturnType<typeof parseCues>): string {
  const lines = [`[시청 지속 분석] ${r.main.title}`, r.main.advice, "", `지속률 ${r.start}% → ${r.end}%, 도입 이탈 ${r.hookLeak}%p(${VERDICT[r.hookVerdict].label})`];
  if (r.cliffs.length) {
    lines.push("", "급락한 곳:");
    r.cliffs.forEach((c, i) => {
      const said = c.fromSec !== null && c.toSec !== null ? saidAt(cues, c.fromSec, c.toSec) : "";
      lines.push(`${i + 1}. ${range(c)} −${c.points}%p${said ? ` “${said}”` : ""}`);
    });
  }
  if (r.rewatches.length) {
    lines.push("", "다시 돌려 본 곳:");
    r.rewatches.forEach((c, i) => lines.push(`${i + 1}. ${range(c)} +${c.points}%p`));
  }
  return lines.join("\n");
}

/** The progress, the result video and the download of one render started from this tool. */
function MadeResult({ job }: { job: Made | undefined }) {
  if (!job) return null;
  return (
    <div className="mt-3 flex w-full flex-col items-start gap-2">
      {job.state === "running" && (
        <div className="h-2 w-full max-w-md overflow-hidden rounded bg-line" role="progressbar" aria-valuenow={Math.round(job.progress * 100)} aria-label="만드는 중">
          <div className="h-full bg-foreground transition-all" style={{ width: `${Math.round(job.progress * 100)}%` }} />
        </div>
      )}
      {job.state === "error" && <p className="text-sm text-bad" role="alert">{job.error}</p>}
      {job.state === "done" && job.id && (
        <>
          <video className="max-h-[420px] max-w-full rounded-md border border-line" controls src={`/api/render/file?id=${job.id}`} />
          {job.note && <p className="text-xs text-bad">{job.note}</p>}
          <p className="text-xs text-muted">{job.durationSec}초 · {((job.bytes ?? 0) / 1024 / 1024).toFixed(1)}MB</p>
          <a className="btn-primary" href={`/api/render/file?id=${job.id}&download=1`}>mp4 다운로드</a>
        </>
      )}
    </div>
  );
}
