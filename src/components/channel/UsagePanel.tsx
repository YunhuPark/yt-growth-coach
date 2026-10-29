"use client";

import { useCallback, useEffect, useState } from "react";
import { KIND_LABEL, marginKrw } from "@/lib/shared/margin";
import type { Pricing } from "@/lib/shared/store";
import type { KindSummary } from "@/lib/shared/usage";
import { api, fmt } from "../shared";

type Recent = {
  id: string; at: string; kind: string; ok: boolean; wallMs: number; inputTokens: number; outputTokens: number; calls: number;
  costUsd: number | null; stages: Record<string, number>; meta: Record<string, number | string | boolean>;
};
type Resp = { pricing: Pricing; summary: KindSummary[]; recent: Recent[] };

const usd = (n: number | null) => (n === null ? "단가 입력 필요" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`);
const sec = (n: number) => (n >= 90 ? `${(n / 60).toFixed(1)}분` : `${n}초`);

/** What each kind of work costs in AI tokens and takes in time, so a price can be set on real numbers. */
export default function UsagePanel() {
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inP, setInP] = useState("");
  const [outP, setOutP] = useState("");
  const [fx, setFx] = useState("");
  const [price, setPrice] = useState("");
  const [saved, setSaved] = useState(false);

  const load = useCallback(
    () =>
      api<Resp>("/api/usage")
        .then((r) => {
          setData(r);
          setInP(r.pricing.inputPerMTok?.toString() ?? "");
          setOutP(r.pricing.outputPerMTok?.toString() ?? "");
          setFx(r.pricing.usdToKrw?.toString() ?? "");
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  const savePricing = async () => {
    setError(null);
    setSaved(false);
    const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
    try {
      await api("/api/usage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputPerMTok: num(inP), outputPerMTok: num(outP), usdToKrw: num(fx) }),
      });
      setSaved(true);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!data) return error ? <p className="text-sm text-bad">{error}</p> : null;
  const fxNum = data.pricing.usdToKrw;
  const priceNum = Number(price);

  return (
    <section className="card flex flex-col gap-4">
      <div>
        <h2 className="font-semibold">AI·처리 원가</h2>
        <p className="text-xs text-muted">
          작업 종류별로 AI 토큰, 처리 시간을 실제로 재서 평균을 보여 줍니다. 가격을 정하는 근거로 쓰세요. 모델 단가는 가정하지 않고 <b>직접 입력한 값</b>으로만 계산합니다(사용 중인
          모델의 현재 단가는 Anthropic 가격 안내에서 확인). 영상 처리(ffmpeg·음성 인식)는 이 컴퓨터에서 하므로 서버로 옮기면 처리 시간만큼 서버 비용이 따로 듭니다.
        </p>
      </div>

      {error && <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-4">
        <label className="field">입력 단가 (USD / 100만 토큰)
          <input className="input" inputMode="decimal" value={inP} onChange={(e) => setInP(e.target.value)} />
        </label>
        <label className="field">출력 단가 (USD / 100만 토큰)
          <input className="input" inputMode="decimal" value={outP} onChange={(e) => setOutP(e.target.value)} />
        </label>
        <label className="field">환율 (원 / USD)
          <input className="input" inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)} />
        </label>
        <div className="flex items-end gap-2">
          <button className="btn-primary" onClick={savePricing}>저장</button>
          {saved && <span className="pb-2 text-xs text-good">저장됨</span>}
        </div>
      </div>

      {data.summary.length === 0 ? (
        <p className="text-sm text-muted">아직 측정된 작업이 없습니다. 쇼츠 뽑기, AI 자동 편집, 영상 주소 분석, AI 추천 등을 한 번씩 써 보면 여기에 쌓입니다.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="field w-56">작업 1건 가격 가정 (원)
              <input className="input" inputMode="numeric" placeholder="예: 500" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
            <p className="pb-2 text-xs text-muted">입력하면 아래 표에 AI 비용을 뺀 남는 금액(마진)이 표시됩니다. 서버 처리비·결제 수수료·세금은 포함되지 않습니다.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1 pr-3">작업</th>
                  <th className="pr-3">횟수</th>
                  <th className="pr-3">평균 토큰 (입력/출력)</th>
                  <th className="pr-3">평균 AI 비용</th>
                  <th className="pr-3">평균 시간</th>
                  <th className="pr-3">단계별 평균 시간</th>
                  {priceNum > 0 && <th>마진</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.summary.map((k) => {
                  const m = priceNum > 0 ? marginKrw(priceNum, k.avgCostUsd, fxNum) : null;
                  return (
                    <tr key={k.kind} className="align-top">
                      <td className="py-2 pr-3 font-medium">{KIND_LABEL[k.kind] ?? k.kind}</td>
                      <td className="pr-3">{k.runs}{k.failed > 0 && <span className="text-xs text-bad"> (실패 {k.failed})</span>}</td>
                      <td className="pr-3">{fmt(k.avgInputTokens)} / {fmt(k.avgOutputTokens)}</td>
                      <td className="pr-3">
                        {k.avgInputTokens === 0 && k.avgOutputTokens === 0 ? <span className="text-muted">AI 호출 없음</span> : usd(k.avgCostUsd)}
                        {k.avgCostUsd !== null && fxNum ? <span className="block text-xs text-muted">약 {fmt(Math.round(k.avgCostUsd * fxNum))}원</span> : null}
                      </td>
                      <td className="pr-3">{sec(k.avgWallSec)}</td>
                      <td className="pr-3 text-xs text-muted">
                        {Object.entries(k.stageAvgSec).map(([s, v]) => `${s} ${sec(v)}`).join(" · ") || "–"}
                        {k.metaAvg.inputSec ? <span className="block">평균 원본 길이 {sec(k.metaAvg.inputSec)}</span> : null}
                      </td>
                      {priceNum > 0 && (
                        <td className={m && m.marginKrw < 0 ? "text-bad" : ""}>
                          {m ? <>{fmt(m.marginKrw)}원 <span className="text-xs text-muted">({m.marginPct}%)</span></> : <span className="text-xs text-muted">단가·환율 필요</span>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <details>
            <summary className="cursor-pointer text-xs text-muted">최근 측정 {data.recent.length}건</summary>
            <ul className="mt-2 space-y-1 text-xs">
              {data.recent.map((r) => (
                <li key={r.id} className={r.ok ? "" : "text-bad"}>
                  {r.at.slice(5, 16).replace("T", " ")} · {KIND_LABEL[r.kind] ?? r.kind}{r.ok ? "" : " (실패)"} · {sec(Math.round(r.wallMs / 100) / 10)} · AI {r.calls}회 ·
                  토큰 {fmt(r.inputTokens)}/{fmt(r.outputTokens)} · {usd(r.costUsd)}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
