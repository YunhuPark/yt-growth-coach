"use client";

import { BASIS, type Basis } from "./shared";
import { hasSource, sourceName, sourceReady, type SourceState } from "./source";

/**
 * Step 1 on every page that edits video: which video, and the confirmation that the creator may use it. Chosen once here, so
 * the tools below don't each ask again.
 */
export default function SourcePanel({ source, onChange }: { source: SourceState; onChange: (s: SourceState) => void }) {
  const set = (patch: Partial<SourceState>) => onChange({ ...source, ...patch });
  const ready = sourceReady(source);

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">1. 편집할 영상</h2>
          <p className="text-xs text-muted">
            영상은 이 컴퓨터에서만 처리됩니다. 아래 도구는 모두 여기서 고른 영상을 씁니다. 지원 형식: mp4, mov, webm, mkv.
          </p>
        </div>
        <span className={`rounded px-2 py-1 text-xs font-medium ${ready ? "bg-good/15 text-good" : "bg-line text-muted"}`}>
          {ready ? `준비됨 · ${sourceName(source)}` : hasSource(source) ? "권리 확인이 필요합니다" : "영상을 골라 주세요"}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">영상 파일 올리기 (최대 600MB)
          <input className="input" type="file" accept="video/*,.mkv" onChange={(e) => set({ file: e.target.files?.[0] ?? null })} />
        </label>
        <label className="field">또는 이 컴퓨터의 파일 경로 (큰 파일·긴 영상은 이쪽이 편합니다)
          <input
            className="input"
            placeholder="D:\영상\원본.mp4"
            value={source.sourcePath}
            disabled={!!source.file}
            onChange={(e) => set({ sourcePath: e.target.value })}
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-md border border-line p-3">
        <legend className="px-1 text-xs font-semibold text-muted">영상 사용 권한 확인 (필수)</legend>
        <select className="input" value={source.basis} onChange={(e) => set({ basis: e.target.value as Basis })}>
          <option value="">이 영상의 권리 관계를 선택하세요</option>
          {BASIS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
        <label className="flex items-start gap-2 text-sm">
          <input className="mt-1" type="checkbox" checked={source.confirmed} onChange={(e) => set({ confirmed: e.target.checked })} />
          <span>
            이 영상은 제가 직접 촬영했거나, 저작권자의 사용 허락(라이선스·협의)을 받은 영상입니다. 방송·타사 영상을 권리 확인 없이 쓰는 경우의 책임은 제게 있음을
            이해합니다.
          </span>
        </label>
      </fieldset>
    </section>
  );
}
