"use client";

import { captionHasBadTimes, type Cap } from "@/lib/captionEdit";

/** Editable caption rows: text and start/end seconds (0 = start of the clip), add, delete, and reset to the original. */
export default function CaptionEditor({ caps, max, onChange, onReset }: { caps: Cap[]; max: number; onChange: (c: Cap[]) => void; onReset: () => void }) {
  const set = (i: number, patch: Partial<Cap>) => onChange(caps.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const bad = captionHasBadTimes;
  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="text-xs text-muted">시간은 이 쇼츠가 시작하는 지점을 0초로 한 초 단위입니다(전체 {max}초). 글자가 비어 있거나 시간이 맞지 않는 줄은 영상에 넣지 않습니다.</p>
      <ul className="space-y-2">
        {caps.map((c, i) => (
          <li key={i} className="grid grid-cols-[4rem_4rem_1fr_auto] items-center gap-2">
            <input className={`input ${bad(c) ? "border-bad" : ""}`} inputMode="decimal" placeholder="시작" value={c.start} onChange={(e) => set(i, { start: e.target.value })} />
            <input className={`input ${bad(c) ? "border-bad" : ""}`} inputMode="decimal" placeholder="끝" value={c.end} onChange={(e) => set(i, { end: e.target.value })} />
            <input className="input" placeholder="자막" value={c.text} onChange={(e) => set(i, { text: e.target.value })} />
            <button className="text-xs text-muted hover:text-bad" onClick={() => onChange(caps.filter((_, j) => j !== i))}>삭제</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button className="btn" onClick={() => onChange([...caps, { start: caps.length ? caps[caps.length - 1].end : "0", end: "", text: "" }])}>+ 자막 추가</button>
        <button className="btn" onClick={onReset}>처음 상태로</button>
      </div>
    </div>
  );
}
