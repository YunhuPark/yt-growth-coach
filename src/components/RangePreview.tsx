"use client";

import { useEffect, useRef, useState } from "react";
import type { Basis } from "./shared";

/** Watch the stretch before spending a render on it. An uploaded file plays in the browser; a path gets a small copy made by the server. */
export default function RangePreview({
  file,
  sourcePath,
  start,
  end,
  basis,
  label = "구간 미리 보기",
}: {
  file: File | null;
  sourcePath: string;
  start: number;
  end: number;
  basis: Basis | "";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);

  // The object URL made for an uploaded file, so it can be released when the card closes or goes away.
  const objectUrl = useRef<string | null>(null);
  const release = () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  };
  useEffect(() => release, []);

  const show = async () => {
    setOpen(true);
    setError(null);
    if (file) {
      release();
      objectUrl.current = URL.createObjectURL(file);
      setSrc(`${objectUrl.current}#t=${start},${end}`);
      return;
    }
    if (!basis) {
      setError("미리 보려면 아래에서 영상의 권리 관계를 선택하고 권한 확인에 체크해 주세요.");
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath, start, end, rights: { confirmed: true, basis } }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `미리 보기 실패 (${res.status})`);
      setSrc(`/api/preview/file?id=${json.id}`);
    } catch (e) {
      setError((e as Error).message);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      {!open && (
        <button className="btn" onClick={show} disabled={busy}>{label}</button>
      )}
      {busy && <p className="text-xs text-muted">미리 보기를 만드는 중…</p>}
      {open && src && (
        <>
          <video
            className="max-h-[300px] max-w-full rounded-md border border-line"
            controls
            src={src}
            onTimeUpdate={(e) => {
              // an uploaded file plays the whole source; stop where the candidate ends
              if (file && e.currentTarget.currentTime >= end) e.currentTarget.pause();
            }}
            onError={() => setError(file ? "브라우저가 이 파일 형식을 재생하지 못합니다. 파일 경로로 넣으면 미리 보기를 만들 수 있습니다." : "미리 보기를 재생하지 못했습니다.")}
          />
          <p className="text-xs text-muted">원본 화면을 낮은 화질로 보여 줍니다. 훅·자막·세로 프레임은 만들기를 누른 뒤 결과에서 확인하세요.</p>
          <button className="text-xs text-muted hover:underline" onClick={() => { release(); setOpen(false); setSrc(null); }}>닫기</button>
        </>
      )}
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
