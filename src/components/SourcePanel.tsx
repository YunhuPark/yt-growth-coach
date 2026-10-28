"use client";

import { useState } from "react";
import Icon from "./Icon";
import { BASIS, type Basis } from "./shared";
import { hasSource, sourceName, sourceReady, type SourceState } from "./source";

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

/**
 * Step 1 on every page that edits video: which video, and the confirmation that the creator may use it. Chosen once here, so
 * the tools below don't each ask again. Once it is ready it folds into one line, and "영상 바꾸기" opens it again.
 */
export default function SourcePanel({ source, onChange, hideTitle = false }: { source: SourceState; onChange: (s: SourceState) => void; hideTitle?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const set = (patch: Partial<SourceState>) => onChange({ ...source, ...patch });
  const ready = sourceReady(source);
  const basisLabel = BASIS.find((b) => b.id === source.basis)?.label;

  if (ready && !editing) {
    return (
      <section id="step-source" className="card flex flex-wrap items-center gap-3 !py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-good/15 text-good" aria-hidden><Icon name="check" size={16} /></span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{sourceName(source)}</p>
          <p className="text-xs text-muted">{basisLabel} · 영상은 이 컴퓨터에서만 처리됩니다</p>
        </div>
        <button className="btn ml-auto" onClick={() => setEditing(true)}>영상 바꾸기</button>
      </section>
    );
  }

  return (
    <section id="step-source" className="card flex flex-col gap-4">
      {!hideTitle && (
      <div>
        <h2 className="text-lg font-bold">① 편집할 영상을 고르세요</h2>
        <p className="text-sm text-muted">한 번 고르면 아래의 모든 작업에서 이 영상을 씁니다. 영상은 이 컴퓨터에서만 처리됩니다.</p>
      </div>
      )}

      <label
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[10px] border-2 border-dashed px-4 py-8 text-center transition-colors ${dragging ? "border-foreground bg-foreground/5" : "border-line hover:border-foreground/50"}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) set({ file: f });
        }}
      >
        <Icon name="film" size={32} className="text-muted" />
        {source.file ? (
          <>
            <span className="font-semibold">{source.file.name}</span>
            <span className="text-xs text-muted">{mb(source.file.size)} · 눌러서 다른 파일 고르기</span>
          </>
        ) : (
          <>
            <span className="font-semibold">영상 파일을 여기로 끌어다 놓거나, 눌러서 고르세요</span>
            <span className="text-xs text-muted">mp4 · mov · webm · mkv · 최대 600MB</span>
          </>
        )}
        <input className="sr-only" type="file" accept="video/*,.mkv" onChange={(e) => set({ file: e.target.files?.[0] ?? null })} />
      </label>
      {source.file && (
        <button className="btn w-fit" onClick={() => set({ file: null })}>파일 빼기</button>
      )}

      <details className="text-sm" open={!!source.sourcePath && !source.file}>
        <summary className="cursor-pointer text-xs font-medium text-muted hover:text-foreground">파일이 600MB보다 크거나 길다면: 이 컴퓨터의 파일 경로로 지정하기</summary>
        <label className="field mt-2">파일 경로 (예: D:\영상\원본.mp4)
          <input
            className="input"
            placeholder="D:\영상\원본.mp4"
            value={source.sourcePath}
            disabled={!!source.file}
            onChange={(e) => set({ sourcePath: e.target.value })}
          />
        </label>
      </details>

      <fieldset className="flex flex-col gap-3 rounded-xl border border-line p-4">
        <legend className="px-1 text-sm font-semibold">이 영상을 써도 되나요? (필수)</legend>
        <select className="input" aria-label="이 영상의 권리 관계" value={source.basis} onChange={(e) => set({ basis: e.target.value as Basis })}>
          <option value="">이 영상의 권리 관계를 선택하세요</option>
          {BASIS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
        <label className="flex items-start gap-2.5 text-sm">
          <input className="mt-1" type="checkbox" checked={source.confirmed} onChange={(e) => set({ confirmed: e.target.checked })} />
          <span>
            이 영상은 제가 직접 촬영했거나, 저작권자의 사용 허락(라이선스·협의)을 받은 영상입니다.
            <span className="block text-xs text-muted">방송·타사 영상을 권리 확인 없이 쓰는 경우의 책임은 제게 있음을 이해합니다.</span>
          </span>
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <span className={ready ? "chip-local" : "chip"}>
          {ready ? "준비됨" : hasSource(source) ? "권리 확인을 마치면 시작할 수 있어요" : "영상을 골라 주세요"}
        </span>
        {ready && <button className="btn-primary" onClick={() => setEditing(false)}>확인</button>}
      </div>
    </section>
  );
}
