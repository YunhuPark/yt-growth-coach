"use client";

import { POSITION_LABEL, PRESET_LABEL, PRESETS, SCALES, type StylePosition } from "@/lib/captionStyle";
import { useCaptionStyle } from "./captionStyleContext";

/**
 * Choose how the hook and captions look. Each choice is shown as a picture drawn the same way the video is, so what is
 * picked here is what comes out.
 */
export default function StylePicker({ title = "자막 스타일" }: { title?: string }) {
  const { style, setStyle } = useCaptionStyle();
  const pic = (preset: string) =>
    `/api/stylepreview?layout=short&preset=${preset}&position=${style.position}&scale=${style.scale}`;

  return (
    <section className="card flex flex-col gap-3">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-xs text-muted">
          훅 자막과 구간 자막의 모양입니다. 아래 그림은 실제로 영상에 들어가는 방식과 같게 그린 것이고, 고른 스타일은 이 화면의 모든 영상 만들기에 적용됩니다. 건드리지 않으면 기본
          스타일입니다.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => setStyle({ ...style, preset: p })}
            className={`flex flex-col items-center gap-1.5 rounded-lg border p-2 text-left ${style.preset === p ? "border-accent bg-accent/5" : "border-line hover:border-accent/50"}`}
            aria-pressed={style.preset === p}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pic(p)} alt={`${PRESET_LABEL[p]} 미리보기`} className="max-h-56 w-auto rounded border border-line" />
            <span className="text-xs font-medium">{PRESET_LABEL[p]}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-xs text-muted">자막 위치</span>
          <select className="input w-auto" value={style.position} onChange={(e) => setStyle({ ...style, position: e.target.value as StylePosition })}>
            {(Object.keys(POSITION_LABEL) as StylePosition[]).map((k) => <option key={k} value={k}>{POSITION_LABEL[k]}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">글자 크기</span>
          {SCALES.map((s) => (
            <label key={s.value} className="flex items-center gap-1.5">
              <input type="radio" name="caption-scale" checked={style.scale === s.value} onChange={() => setStyle({ ...style, scale: s.value })} />
              {s.label}
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
