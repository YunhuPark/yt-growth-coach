"use client";

import { useEffect, useState } from "react";
import type { Pack } from "@/lib/package";
import type { Idea } from "@/lib/recommend";
import type { SourceResult } from "@/lib/sources";
import { api, fmt } from "./shared";

type SavedPack = { at: string; idea: Idea; pack: Pack };
type Cap = { start: string; end: string; text: string };
type Basis = "own_footage" | "licensed" | "rights_holder_permission";

const BASIS: { id: Basis; label: string }[] = [
  { id: "own_footage", label: "제가 직접 촬영한 영상" },
  { id: "licensed", label: "라이선스를 취득한 영상" },
  { id: "rights_holder_permission", label: "권리자에게 사용 허락을 받은 영상" },
];

const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
};
const mins = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)}시간` : `${Math.round(s / 60)}분`);

/** "2–7초" -> [2, 7] */
const parseRange = (t: string): [number, number] | null => {
  const m = /(\d+(?:\.\d+)?)\s*[–\-~]\s*(\d+(?:\.\d+)?)/.exec(t);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

const PLACEHOLDER = /\[[^\]]*\]/;

export default function Studio() {
  const [packs, setPacks] = useState<Record<string, SavedPack> | null>(null);
  const [key, setKey] = useState("");

  useEffect(() => {
    api<Record<string, SavedPack>>("/api/package")
      .then((p) => {
        setPacks(p);
        setKey(Object.keys(p)[0] ?? "");
      })
      .catch(() => setPacks({}));
  }, []);

  if (!packs) return <p className="text-muted">불러오는 중…</p>;
  const keys = Object.keys(packs);
  if (!keys.length) {
    return (
      <section className="card text-sm">
        <p className="font-medium">먼저 제작 패키지가 필요합니다.</p>
        <p className="mt-1 text-muted">AI 추천 탭에서 영상 아이디어의 “제작 패키지 만들기”를 누른 뒤 이 탭으로 오세요.</p>
      </section>
    );
  }
  const saved = packs[key];

  return (
    <div className="flex flex-col gap-5">
      <section className="card">
        <label className="field">제작할 아이디어
          <select className="input" value={key} onChange={(e) => setKey(e.target.value)}>
            {keys.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
      </section>
      {saved && (
        <>
          <Sources idea={saved.idea} />
          <Edit key={key} pack={saved.pack} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- A. source candidates

function Sources({ idea }: { idea: Idea }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<SourceResult | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setRes(
        await api<SourceResult>("/api/sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idea, refresh: !!res }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">A. 소재 후보 찾기</h2>
          <p className="text-xs text-muted">
            아이디어의 장면이 있을 만한 원본 영상을 검색해 링크로 보여줍니다. 영상은 내려받지 않으며, 장면 위치는 업로더의 타임스탬프와 시청자 댓글로 짚어
            줍니다. (API 할당량 약 600 소모)
          </p>
        </div>
        <button className="btn-primary" onClick={run} disabled={busy}>
          {busy ? "찾는 중… (30초~1분)" : res ? "다시 찾기" : "소재 후보 찾기"}
        </button>
      </div>
      {error && <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      {res && (
        <>
          <div className="rounded-md border border-line p-3 text-sm">
            <p><b>찾는 장면</b> {res.scene}</p>
            <p className="mt-1 text-xs text-muted">검색어: {res.queries.join(" · ")}</p>
          </div>
          {!res.commentsAvailable && (
            <p className="rounded-md border border-line bg-card px-3 py-2 text-xs text-muted">
              시청자 댓글로 장면 위치를 짚으려면 <code>.env.local</code>에 <code>YOUTUBE_API_KEY</code>가 필요합니다. 지금은 업로더 타임스탬프만 표시됩니다.
            </p>
          )}
          {res.videos.length === 0 ? (
            <p className="text-sm text-muted">이 아이디어와 관련된 원본 영상을 찾지 못했습니다. “다시 찾기”를 눌러 다른 검색어로 시도해 보세요.</p>
          ) : (
            <ul className="divide-y divide-line">
              {res.videos.map((v) => (
                <li key={v.id} className="py-3 text-sm">
                  <a className="font-medium hover:underline" href={`https://youtu.be/${v.id}`} target="_blank" rel="noreferrer">
                    {v.title}
                  </a>
                  {v.kind !== "unknown" && (
                    <span
                      className={`ml-2 rounded px-1.5 py-0.5 text-xs ${
                        v.kind === "official" ? "bg-good/15 text-good" : "bg-bad/15 text-bad"
                      }`}
                    >
                      {v.kind === "official" ? "공식·방송사 채널일 가능성" : "다른 팬의 편집본일 가능성 · 재사용 주의"}
                    </span>
                  )}
                  <p className="text-xs text-muted">
                    {v.channelTitle} · {mins(v.durationSec)} · 조회수 {fmt(v.views)} · {v.publishedAt.slice(0, 10)}
                  </p>
                  {v.hotspots.length > 0 && (
                    <div className="mt-1.5">
                      <p className="text-xs font-semibold text-muted">시청자가 짚은 장면 (좋아요 순)</p>
                      <ul className="mt-0.5 space-y-0.5">
                        {v.hotspots.map((h, i) => (
                          <li key={i} className="text-xs">
                            <a className="font-medium text-accent hover:underline" href={`https://youtu.be/${v.id}?t=${h.sec}`} target="_blank" rel="noreferrer">
                              {clock(h.sec)}
                            </a>{" "}
                            {h.text} <span className="text-muted">· 좋아요 {fmt(h.likes)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {v.chapters.length > 0 && (
                    <div className="mt-1.5">
                      <p className="text-xs font-semibold text-muted">업로더가 적은 타임스탬프</p>
                      <ul className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5">
                        {v.chapters.map((c, i) => (
                          <li key={i} className="text-xs">
                            <a className="font-medium text-accent hover:underline" href={`https://youtu.be/${v.id}?t=${c.sec}`} target="_blank" rel="noreferrer">
                              {clock(c.sec)}
                            </a>{" "}
                            {c.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">
            표시는 제목·채널명으로 한 추정일 뿐입니다. 다른 사람이 편집한 영상을 다시 쓰면 그 편집물의 저작권까지 겹칩니다. 목록은 링크일 뿐이며 사용 가능 여부를 의미하지 않습니다. 방송·공식 영상은 권리자의 정책(팬 편집 허용 범위, 협의 필요 여부)을 직접 확인하세요.
          </p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- B. edit automation

function Edit({ pack }: { pack: Pack }) {
  const [file, setFile] = useState<File | null>(null);
  const [fit, setFit] = useState<"blur" | "cover">("blur");
  const [trimStart, setTrimStart] = useState("");
  const [trimEnd, setTrimEnd] = useState("");
  const [hook, setHook] = useState(pack.hook_caption);
  const [hookSec, setHookSec] = useState("2.2");
  const [caps, setCaps] = useState<Cap[]>(() =>
    pack.shot_plan
      .map((s) => ({ r: parseRange(s.time), text: s.caption }))
      .filter((x) => x.r && x.text.trim() && x.text.trim() !== pack.hook_caption.trim())
      .map((x) => ({ start: String(x.r![0]), end: String(x.r![1]), text: x.text })),
  );
  const [ending, setEnding] = useState(pack.ending_cta);
  const [endSec, setEndSec] = useState("1.6");
  const [basis, setBasis] = useState<Basis | "">("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<{ id: string; durationSec: number; bytes: number } | null>(null);

  const blanks = [hook, ending, ...caps.map((c) => c.text)].filter((t) => PLACEHOLDER.test(t));
  const ready = !!file && confirmed && !!basis && blanks.length === 0 && !busy;

  const render = async () => {
    if (!file || !basis) return;
    setBusy(true);
    setError(null);
    setOut(null);
    const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
    const options = {
      fit,
      trimStart: num(trimStart),
      trimEnd: num(trimEnd),
      hook: hook.trim() ? { text: hook, seconds: Number(hookSec) || 2.2 } : undefined,
      captions: caps.map((c) => ({ start: Number(c.start) || 0, end: Number(c.end) || 0, text: c.text })),
      ending: ending.trim() ? { text: ending, seconds: Number(endSec) || 1.6 } : undefined,
      rights: { confirmed: true, basis },
    };
    const fd = new FormData();
    fd.append("file", file);
    fd.append("options", JSON.stringify(options));
    try {
      const res = await fetch("/api/render", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `렌더링 실패 (${res.status})`);
      setOut(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setCap = (i: number, patch: Partial<Cap>) => setCaps(caps.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <section className="card flex flex-col gap-4">
      <div>
        <h2 className="font-semibold">B. 편집 자동화</h2>
        <p className="text-xs text-muted">
          내가 가진 영상 파일에 세로 변환, 훅 자막, 구간 자막, 엔딩 CTA 카드를 입혀 쇼츠 규격(1080×1920) mp4로 만듭니다. 파일은 이 컴퓨터에서만 처리되고
          업로드는 직접 하셔야 합니다.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field sm:col-span-2">영상 파일 (mp4, mov, webm, mkv · 최대 600MB)
          <input className="input" type="file" accept="video/*,.mkv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="field">화면 맞춤
          <select className="input" value={fit} onChange={(e) => setFit(e.target.value as typeof fit)}>
            <option value="blur">전체 화면 유지 + 배경 블러 (가로 영상에 추천)</option>
            <option value="cover">꽉 채우기 (좌우 잘림)</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="field">시작(초, 선택)
            <input className="input" inputMode="decimal" placeholder="0" value={trimStart} onChange={(e) => setTrimStart(e.target.value)} />
          </label>
          <label className="field">끝(초, 선택)
            <input className="input" inputMode="decimal" placeholder="전체" value={trimEnd} onChange={(e) => setTrimEnd(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <label className="field">첫 화면 훅 자막
          <input className="input" value={hook} onChange={(e) => setHook(e.target.value)} />
        </label>
        <label className="field">표시 시간(초)
          <input className="input" inputMode="decimal" value={hookSec} onChange={(e) => setHookSec(e.target.value)} />
        </label>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-muted">구간 자막 (시작–끝 초는 자른 뒤 영상 기준)</span>
          <button className="btn" onClick={() => setCaps([...caps, { start: "", end: "", text: "" }])}>+ 자막 추가</button>
        </div>
        <ul className="space-y-2">
          {caps.map((c, i) => (
            <li key={i} className="grid grid-cols-[4rem_4rem_1fr_auto] items-center gap-2">
              <input className="input" inputMode="decimal" placeholder="시작" value={c.start} onChange={(e) => setCap(i, { start: e.target.value })} />
              <input className="input" inputMode="decimal" placeholder="끝" value={c.end} onChange={(e) => setCap(i, { end: e.target.value })} />
              <input className="input" placeholder="자막" value={c.text} onChange={(e) => setCap(i, { text: e.target.value })} />
              <button className="text-xs text-muted hover:text-bad" onClick={() => setCaps(caps.filter((_, j) => j !== i))}>삭제</button>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <label className="field">엔딩 CTA 카드
          <input className="input" value={ending} onChange={(e) => setEnding(e.target.value)} />
        </label>
        <label className="field">표시 시간(초)
          <input className="input" inputMode="decimal" value={endSec} onChange={(e) => setEndSec(e.target.value)} />
        </label>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-md border border-line p-3">
        <legend className="px-1 text-xs font-semibold text-muted">영상 사용 권한 확인 (필수)</legend>
        <select className="input" value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
          <option value="">이 영상의 권리 관계를 선택하세요</option>
          {BASIS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
        <label className="flex items-start gap-2 text-sm">
          <input className="mt-1" type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>
            이 영상은 제가 직접 촬영했거나, 저작권자의 사용 허락(라이선스·협의)을 받은 영상입니다. 방송·타사 영상을 권리 확인 없이 쓰는 경우의 책임은
            제게 있음을 이해합니다.
          </span>
        </label>
      </fieldset>

      {blanks.length > 0 && (
        <p className="rounded-md border border-line bg-card px-3 py-2 text-sm text-muted">
          아직 빈칸이 남아 있습니다: {blanks.map((b) => `“${b}”`).join(", ")} — 클립을 보고 실제 내용으로 바꾼 뒤 렌더링하세요.
        </p>
      )}
      {error && <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <div>
        <button className="btn-primary" onClick={render} disabled={!ready}>
          {busy ? "렌더링 중… (영상 길이에 따라 10초~수 분)" : "쇼츠 영상 만들기"}
        </button>
      </div>

      {out && (
        <div className="flex flex-col items-start gap-2">
          <video className="max-h-[560px] rounded-md border border-line" controls src={`/api/render/file?id=${out.id}`} />
          <p className="text-xs text-muted">
            {out.durationSec}초 · {(out.bytes / 1024 / 1024).toFixed(1)}MB · 1080×1920
          </p>
          <a className="btn-primary" href={`/api/render/file?id=${out.id}&download=1`}>mp4 다운로드</a>
        </div>
      )}
    </section>
  );
}
