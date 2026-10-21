// Pure money arithmetic, free of server-only imports so the browser can use it too.

/** Margin on a price per run: price minus the AI cost, in KRW. Null while the cost or the exchange rate is unknown. */
export function marginKrw(priceKrw: number, avgCostUsd: number | null, usdToKrw: number | undefined) {
  if (avgCostUsd === null || !usdToKrw) return null;
  const cost = avgCostUsd * usdToKrw;
  return { costKrw: Math.round(cost), marginKrw: Math.round(priceKrw - cost), marginPct: priceKrw > 0 ? Math.round(((priceKrw - cost) / priceKrw) * 100) : 0 };
}

/** Readable names for the kinds of work that get measured. */
export const KIND_LABEL: Record<string, string> = {
  highlights: "쇼츠 뽑기 (D, 파일 분석)",
  autoedit: "AI 자동 편집 (C)",
  urlplan: "영상 주소 분석 (E)",
  rangecaptions: "구간 자막 (음성 인식)",
  render: "렌더링",
  recommend: "AI 추천",
  package: "제작 패키지",
  sources: "소재 후보 찾기",
  "channel-profile": "채널 파악",
  "channel-judge": "비슷한 채널 선별",
};
