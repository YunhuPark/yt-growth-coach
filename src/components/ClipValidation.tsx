"use client";

import { useCallback, useEffect, useState } from "react";
import { VERDICT_TEXT, type Validation } from "@/lib/clipValidation";
import type { ClipRecord } from "@/lib/store";
import { api, fmt } from "./shared";

type Video = { id: string; title: string; publishedAt: string; score: number | null; viewsPerDay: number };
type Resp = { clips: ClipRecord[]; videos: Video[]; videosError: string | null; validation: Validation };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Shorts made from AI candidates, linked to the videos they became, and a check of whether the AI's scores held up. */
export default function ClipValidation() {
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<Resp>("/api/clips")
        .then(setData)
        .catch((e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  const link = async (id: string, video: string | null) => {
    setError(null);
    try {
      await api("/api/clips", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, video }) });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (id: string) => {
    await api(`/api/clips?id=${id}`, { method: "DELETE" }).catch((e: Error) => setError(e.message));
    load();
  };

  if (!data) return error ? <p className="text-sm text-bad">{error}</p> : null;
  if (!data.clips.length) return null; // nothing made from candidates yet

  const v = data.validation;
  const byId = new Map(data.videos.map((x) => [x.id, x]));
  const takenBy = new Map(data.clips.filter((c) => c.videoId).map((c) => [c.videoId!, c.id]));

  return (
    <section className="card flex flex-col gap-3">
      <div>
        <h2 className="font-semibold">AI 점수 검증</h2>
        <p className="text-xs text-muted">
          쇼츠 뽑기에서 만든 쇼츠를 실제로 올린 영상에 연결하면, AI가 준 점수가 실제 성과(업로드 7일 후 품질 점수)와 얼마나 맞았는지 비교합니다.
        </p>
      </div>

      {error && <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      {data.videosError && (
        <p className="rounded-md border border-line bg-card px-3 py-2 text-xs text-muted">내 채널 영상을 불러오지 못해 목록에서 고르는 기능이 꺼져 있습니다(주소 입력은 가능): {data.videosError}</p>
      )}

      <div className="rounded-md border border-line p-3 text-sm">
        <p>
          <b>연결된 쇼츠 {v.linked}개</b> · 점수가 매겨진 영상 {v.rated}개
          {v.rho !== null && <> · 순위 상관 <b>{v.rho}</b></>}
        </p>
        <p className="mt-1">{VERDICT_TEXT[v.verdict]}</p>
        {v.halves && (
          <p className="mt-1 text-xs text-muted">
            AI 점수가 높았던 쪽 평균 실제 점수 {v.halves.high} · 낮았던 쪽 {v.halves.low}
          </p>
        )}
        <p className="mt-1 text-xs text-muted">상관은 −1~1이며 표본이 적을 땐 우연히 좋게 나올 수 있습니다. 5개 미만이면 판단하지 않습니다.</p>
      </div>

      <ul className="flex flex-col divide-y divide-line">
        {data.clips.map((c) => {
          const vid = c.videoId ? byId.get(c.videoId) : undefined;
          return (
            <li key={c.id} className="flex flex-col gap-1.5 py-3 text-sm first:pt-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-xs font-semibold text-accent">AI {c.aiScore}점</span>
                <span className="font-medium">{c.title || c.hook || c.id}</span>
                <span className="text-xs text-muted">
                  {c.sourceName} {clock(c.start)}–{clock(c.end)} · {c.at.slice(0, 10)}
                </span>
                <button className="ml-auto text-xs text-muted hover:text-bad" onClick={() => remove(c.id)}>기록 삭제</button>
              </div>
              {c.videoId ? (
                <p className="text-xs">
                  연결됨:{" "}
                  <a className="text-accent hover:underline" href={`https://youtu.be/${c.videoId}`} target="_blank" rel="noreferrer">
                    {vid?.title ?? c.videoId}
                  </a>{" "}
                  ·{" "}
                  {vid ? (
                    vid.score === null ? <span className="text-muted">업로드 7일이 지나면 점수가 매겨집니다</span> : <span>실제 점수 {Math.round(vid.score)} · 하루 조회 {fmt(vid.viewsPerDay)}</span>
                  ) : (
                    <span className="text-muted">내 채널 쇼츠 목록에서 찾지 못했습니다</span>
                  )}{" "}
                  <button className="text-muted hover:text-bad" onClick={() => link(c.id, null)}>연결 해제</button>
                </p>
              ) : (
                <LinkRow videos={data.videos.filter((x) => !takenBy.has(x.id))} onLink={(x) => link(c.id, x)} />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LinkRow({ videos, onLink }: { videos: Video[]; onLink: (video: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {videos.length > 0 && (
        <select className="input w-auto max-w-[22rem]" value="" onChange={(e) => e.target.value && onLink(e.target.value)}>
          <option value="">올린 영상 고르기…</option>
          {[...videos]
            .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
            .slice(0, 40)
            .map((x) => (
              <option key={x.id} value={x.id}>{x.publishedAt.slice(0, 10)} · {x.title.slice(0, 40)}</option>
            ))}
        </select>
      )}
      <input className="input w-56" placeholder="또는 영상 주소/ID 붙여넣기" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn" disabled={!text.trim()} onClick={() => onLink(text)}>연결</button>
    </div>
  );
}
