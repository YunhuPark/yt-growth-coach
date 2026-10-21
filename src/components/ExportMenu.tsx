"use client";

import { useState } from "react";
import { safeFileName, toCutList, toEdl, toSrt, type Cue, type Cut } from "@/lib/exporters";

/** Saves a text file through the browser. */
function downloadText(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const FPS = [24, 25, 30, 50, 60];

/**
 * Hand the result to another editor: the subtitles as SRT, the cuts as an EDL (Premiere, DaVinci) or as a plain list to
 * follow by hand (CapCut). `cues` are on the edited video's timeline; `cuts` are ranges of the source.
 */
export default function ExportMenu({ baseName, clipName, cues, cuts }: { baseName: string; clipName: string; cues: Cue[]; cuts: Cut[] }) {
  const [fps, setFps] = useState(30);
  const [extras, setExtras] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The hook and the ending card are titles, not subtitles: left out of the SRT unless asked for.
  const hasExtras = cues.some((c) => c.kind === "hook" || c.kind === "ending");
  const srt = toSrt(extras ? cues : cues.filter((c) => (c.kind ?? "caption") === "caption"));
  const name = (ext: string) => safeFileName(baseName, ext);

  const edl = () => {
    setError(null);
    try {
      downloadText(name("edl"), toEdl({ title: baseName, fps, cuts, clipName }), "text/plain");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">편집 프로그램으로 내보내기</span>
        <button className="btn" disabled={!srt} onClick={() => downloadText(name("srt"), srt, "application/x-subrip")} title="CapCut·Premiere·DaVinci에서 자막으로 불러올 수 있습니다">
          자막 SRT
        </button>
        <button className="btn" disabled={!cuts.length} onClick={edl} title="Premiere·DaVinci Resolve에서 컷 편집으로 불러옵니다(원본과 같은 프레임 레이트 선택)">
          컷 목록 EDL
        </button>
        <select className="input w-auto" value={fps} onChange={(e) => setFps(Number(e.target.value))} aria-label="원본 영상의 프레임 레이트" title="EDL은 시간을 프레임 단위로 적으므로 원본 영상의 프레임 레이트와 같아야 합니다">
          {FPS.map((f) => <option key={f} value={f}>{f}fps</option>)}
        </select>
        <button className="btn" disabled={!cuts.length} onClick={() => downloadText(name("txt"), toCutList({ clipName, cuts }), "text/plain")} title="CapCut처럼 불러오기가 안 되는 편집기에서 보고 따라 할 컷 목록">
          컷 목록 텍스트
        </button>
      </div>
      {hasExtras && (
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={extras} onChange={(e) => setExtras(e.target.checked)} />
          훅·엔딩 문구도 자막 파일에 넣기 (기본은 대사 자막만)
        </label>
      )}
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
