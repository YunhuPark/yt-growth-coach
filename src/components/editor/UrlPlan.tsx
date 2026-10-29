"use client";

import { useState } from "react";
import { formatClock } from "@/lib/editor/chapters";
import { lengthMismatch, MISMATCH_LIMIT } from "@/lib/editor/mismatch";
import type { UrlPlan as Plan } from "@/lib/editor/urlPlan";
import BriefRender from "./BriefRender";
import PlanPanel from "./PlanPanel";
import { api, fmt } from "../shared";
import { sourceName, sourceReady, type SourceState } from "./source";
import ToolIntro from "./ToolIntro";

const FIT_LABEL = { within: "내 채널 잘된 길이", shorter: "내 채널 잘된 쇼츠보다 짧음", longer: "내 채널 잘된 쇼츠보다 김" } as const;
const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => {});

/** E. Paste a YouTube address: moments viewers point at in the comments become Shorts candidates with an edit brief. Nothing is downloaded. */
export default function UrlPlan({ topic: initialTopic, source }: { topic: string; source: SourceState }) {
  const [url, setUrl] = useState("");
  const [topic, setTopic] = useState(initialTopic);
  const [count, setCount] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  // The file of the original video, if the creator has one (chosen once at the top of the page): briefs can then be turned straight into Shorts.
  const { file, sourcePath, basis } = source;
  const [speech, setSpeech] = useState(true);
  const ready = sourceReady(source);
  // The long-form plan spans the whole video, so the file is checked against the original's length before it is used.
  const [fileSec, setFileSec] = useState<number | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [okMismatch, setOkMismatch] = useState(false);

  const body = (options: object) => {
    const fd = new FormData();
    if (file) fd.append("file", file);
    fd.append("options", JSON.stringify({ ...options, sourcePath: !file && sourcePath.trim() ? sourcePath.trim() : undefined, rights: { confirmed: true, basis } }));
    return fd;
  };

  const checkFile = async () => {
    setChecking(true);
    setFileErr(null);
    setOkMismatch(false);
    try {
      const res = await fetch("/api/rangecaptions", { method: "POST", body: body({ start: 0, end: 1, speech: false }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `파일 확인 실패 (${res.status})`);
      setFileSec(json.fileDurationSec as number);
    } catch (e) {
      setFileSec(null);
      setFileErr((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    setPlan(null);
    try {
      setPlan(
        await api<Plan>("/api/urlplan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim(), topic, count }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card flex flex-col gap-4">
      <ToolIntro
        icon="link"
        title="영상 주소로 분석"
        summary="유튜브 주소만 붙이면 영상 요약과 내 채널에 쓸 주제·제목·쇼츠 구간·롱폼 구성안을 만들어 줍니다. 영상 파일은 필요 없습니다."
        steps={["유튜브 영상 주소를 붙입니다", "분석 버튼을 누릅니다", "제안된 주제·제목·구간을 확인하고 활용합니다"]}
        uses="ai"
      >
        유튜브 영상 주소를 붙이면 AI가 영상이 무엇에 관한 것인지 정리하고, 내 채널에서 쓸 <b>주제·제목</b>, 쇼츠로 잘라 올리기 좋은 <b>구간</b>(편집 지시서 포함),
          <b>롱폼 구성안</b>(챕터 포함)을 만들어 줍니다. 영상을 내려받거나 복사하지 않습니다. <b>AI는 영상을 직접 보거나 듣지 못하고</b>, 공개된 제목·설명·챕터·댓글과
          YouTube가 제공하는 미리보기 이미지 4장(대표 이미지와 영상 중간 장면 3장)만 근거로 합니다. 그래서 파일 분석(D)보다 정확도가 낮고, 시간을 짚은 댓글이나 챕터가
          없으면 쇼츠 구간과 롱폼은 만들지 않습니다. 원본을 쓸 권리는 직접 확인하세요.
      </ToolIntro>

      <div className="grid gap-3 sm:grid-cols-[1fr_16rem_8rem]">
        <label className="field">영상 주소
          <input className="input" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label className="field">주제 (AI에게 전달)
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} />
        </label>
        <label className="field">후보 수
          <select className="input" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>최대 {n}개</option>)}
          </select>
        </label>
      </div>

      {error && <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <button className="btn-primary w-fit" onClick={run} disabled={busy || !url.trim()}>
        {busy ? "댓글·설명·이미지를 읽고 분석하는 중… (30초~1분)" : plan ? "다시 분석하기" : "영상 분석하기"}
      </button>

      {plan && (
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-line p-3 text-sm">
            <a className="font-medium hover:underline" href={plan.video.url} target="_blank" rel="noreferrer">{plan.video.title}</a>
            <p className="text-xs text-muted">
              {plan.video.channelTitle} · {formatClock(plan.video.durationSec)} · 조회수 {fmt(plan.video.views)} · {plan.video.publishedAt.slice(0, 10)}
            </p>
          </div>

          <p className="text-xs text-muted">
            AI가 근거로 쓴 것: 제목·설명 · 챕터 {plan.evidence.chapters}개 · 시간을 짚은 댓글 {plan.evidence.comments}개 · 반응 큰 댓글 {plan.evidence.topComments}개 · 미리보기 이미지 {plan.evidence.frames}장
          </p>
          {plan.note && <p className="rounded-md border border-line bg-card px-3 py-2 text-xs text-muted">{plan.note}</p>}

          <div className="rounded-md border border-line p-3">
            <p className="mb-1 text-xs font-semibold text-muted">영상 요약</p>
            <p className="text-sm">{plan.summary}</p>
          </div>

          {plan.topics.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">내 채널에서 쓸 주제</p>
              <ul className="space-y-2">
                {plan.topics.map((t, i) => (
                  <li key={i} className="rounded-md border border-line px-3 py-2 text-sm">
                    <p className="font-medium">{t.topic}</p>
                    <p className="text-xs">{t.angle}</p>
                    <p className="text-xs text-muted">근거: {t.why}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.titles.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">제목 후보</p>
              <ul className="space-y-1 text-sm">
                {plan.titles.map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <span>{t}</span>
                    <button className="text-xs text-accent hover:underline" onClick={() => copy(t)}>복사</button>
                  </li>
                ))}
              </ul>
            </div>
          )}


          {plan.candidates.length > 0 || plan.longform ? (
            <div className="flex flex-col gap-3">
              <fieldset className="flex flex-col gap-3 rounded-md border border-line p-3">
                <legend className="px-1 text-xs font-semibold text-muted">파일로 바로 만들기 (원본 영상 파일이 있을 때)</legend>
                <p className="text-xs text-muted">
                  이 영상의 파일을 이미 가지고 있다면 위 “1. 편집할 영상”에서 고른 뒤, 아래 후보의 “이 지시서로 쇼츠 만들기”로 그 구간을 바로 잘라 훅·대사 자막을 붙인
                  쇼츠를 만듭니다(분석 없이 빠름). 파일은 이 앱이 받아 오지 않으며, 직접 구하신 파일만 쓸 수 있습니다. 파일 길이가 원본 영상과 다르면 알려 드립니다.
                </p>
                <label className="flex items-start gap-2 text-sm">
                  <input className="mt-1" type="checkbox" checked={speech} onChange={(e) => setSpeech(e.target.checked)} />
                  <span>음성 인식으로 그 구간의 대사 자막 만들기 <span className="text-xs text-muted">(이 컴퓨터에서 처리 · 처음 한 번은 모델 약 240MB를 내려받음)</span></span>
                </label>
                {!ready && <p className="text-xs text-muted">영상을 고르고 권한 확인을 하면 아래 후보를 바로 영상으로 만들 수 있습니다.</p>}
              </fieldset>

            </div>
          ) : null}

          {plan.candidates.length > 0 && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted">점수 순 · 후보 {plan.candidates.length}개</p>
                <button className="btn" onClick={() => copy(plan.candidates.map((c, i) => `[후보 ${i + 1} · AI ${c.score}점]\n${c.brief}`).join("\n\n"))}>
                  모든 편집 지시서 복사
                </button>
              </div>
              <ul className="flex flex-col gap-3">
                {plan.candidates.map((c, i) => (
                  <li key={i} className="flex flex-col gap-2 rounded-md border border-line p-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="rounded bg-accent/15 px-1.5 py-0.5 text-xs font-semibold text-accent">{c.score}점</span>
                      <a className="font-medium text-accent hover:underline" href={c.link} target="_blank" rel="noreferrer">
                        {formatClock(c.start)}–{formatClock(c.end)}
                      </a>
                      <span className="text-xs text-muted">{Math.round(c.end - c.start)}초</span>
                      {c.lengthFit && (
                        <span className={`rounded px-1.5 py-0.5 text-xs ${c.lengthFit === "within" ? "bg-good/15 text-good" : "bg-line text-muted"}`}>
                          {FIT_LABEL[c.lengthFit]}
                        </span>
                      )}
                    </div>
                    <p className="text-sm">{c.reason}</p>
                    {c.evidence.comments > 0 && (
                      <p className="text-xs text-muted">
                        이 구간을 짚은 댓글 {c.evidence.comments}개 · 좋아요 {fmt(c.evidence.likes)}
                        {c.evidence.samples.length > 0 && <> · {c.evidence.samples.map((t) => `“${t}”`).join(" ")}</>}
                      </p>
                    )}
                    <p className="text-sm"><span className="text-xs text-muted">훅 자막</span> {c.hook}</p>
                    <p className="text-sm"><span className="text-xs text-muted">제목 후보</span> {c.title}</p>
                    <details className="rounded-md border border-line px-3 py-2">
                      <summary className="cursor-pointer text-sm">편집 지시서 보기</summary>
                      <pre className="mt-2 whitespace-pre-wrap text-xs">{c.brief}</pre>
                      <button className="mt-2 text-xs text-accent hover:underline" onClick={() => copy(c.brief)}>지시서 복사</button>
                    </details>
                    <BriefRender c={c} video={plan.video} file={file} sourcePath={sourcePath.trim()} basis={basis} speech={speech} ready={ready} clipName={sourceName(source) || plan.video.title} />
                  </li>
                ))}
              </ul>
            </>
          )}

          {plan.longform && (
            <div className="flex flex-col gap-2">
              <h3 className="font-semibold">롱폼 구성안 (1920×1080 가로)</h3>
              <p className="text-xs text-muted">
                원본에서 남길 구간과 챕터, 제목, 설명입니다. 파일이 있으면 아래에서 파일 길이를 확인한 뒤 이 구성대로 바로 만들 수 있습니다(영상 길이에 따라 몇 분 걸림).
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn" onClick={checkFile} disabled={!ready || checking}>{checking ? "파일 확인 중…" : "파일 길이 확인"}</button>
                {fileSec !== null && (
                  <span className="text-xs text-muted">파일 {formatClock(fileSec)} · 원본 영상 {formatClock(plan.video.durationSec)}</span>
                )}
                {!ready && <span className="text-xs text-muted">위의 “파일로 바로 만들기”에서 파일과 권한 확인을 먼저 채워 주세요.</span>}
              </div>
              {fileErr && <p className="text-sm text-bad">{fileErr}</p>}
              {fileSec !== null && lengthMismatch(fileSec, plan.video.durationSec) > MISMATCH_LIMIT && (
                <label className="flex items-start gap-2 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
                  <input className="mt-1" type="checkbox" checked={okMismatch} onChange={(e) => setOkMismatch(e.target.checked)} />
                  <span>파일 길이가 원본 영상과 달라 구간 시간이 어긋날 수 있습니다. 그래도 이 시간대로 만듭니다.</span>
                </label>
              )}
              <PlanPanel
                plan={plan.longform}
                layout="long"
                body={body}
                clipName={sourceName(source) || plan.video.title}
                disabled={!ready || fileSec === null || (lengthMismatch(fileSec, plan.video.durationSec) > MISMATCH_LIMIT && !okMismatch)}
              />
            </div>
          )}

          {plan.moments.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-muted">시청자가 짚은 순간 {plan.moments.length}곳 (참고)</summary>
              <ul className="mt-1 space-y-0.5">
                {plan.moments.map((m) => (
                  <li key={m.sec} className="text-xs">
                    <a className="font-medium text-accent hover:underline" href={`${plan.video.url}?t=${m.sec}`} target="_blank" rel="noreferrer">{formatClock(m.sec)}</a>{" "}
                    댓글 {m.comments}개 · 좋아요 {fmt(m.likes)} · {m.samples[0]}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
