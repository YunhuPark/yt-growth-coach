// How the hook and caption text look in a render: a colour/box preset, where captions sit, and a size. Pure and free of
// server imports so the browser can offer the same choices; the renderer turns a style into drawtext options here.

export type StylePreset = "box" | "outline" | "yellow" | "minimal";
export type StylePosition = "top" | "middle" | "bottom";
export type CaptionStyle = { preset: StylePreset; position: StylePosition; scale: number };

export const DEFAULT_STYLE: CaptionStyle = { preset: "box", position: "bottom", scale: 1 };

export const PRESETS: StylePreset[] = ["box", "outline", "yellow", "minimal"];
export const PRESET_LABEL: Record<StylePreset, string> = {
  box: "기본 (검은 박스)",
  outline: "굵은 외곽선",
  yellow: "노란 강조",
  minimal: "미니멀 (작은 박스)",
};
export const POSITION_LABEL: Record<StylePosition, string> = { top: "위", middle: "가운데", bottom: "아래" };
export const SCALES: { value: number; label: string }[] = [
  { value: 0.8, label: "작게" },
  { value: 1, label: "보통" },
  { value: 1.25, label: "크게" },
];

export const MIN_SCALE = 0.6;
export const MAX_SCALE = 1.6;

/** Whatever was given, as a style the renderer can use: unknown values fall back to the default, the size is kept in range. */
export function normalizeStyle(s?: Partial<CaptionStyle> | null): CaptionStyle {
  const preset = PRESETS.includes(s?.preset as StylePreset) ? (s!.preset as StylePreset) : DEFAULT_STYLE.preset;
  const position = (["top", "middle", "bottom"] as const).includes(s?.position as StylePosition) ? (s!.position as StylePosition) : DEFAULT_STYLE.position;
  const raw = Number(s?.scale);
  const scale = Number.isFinite(raw) && raw > 0 ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw)) : DEFAULT_STYLE.scale;
  return { preset, position, scale };
}

/** The layout's own sizes for one kind of text (see LAYOUTS in render.ts). */
export type TextBase = { size: number; border?: number; box?: number; y: string; wrap: number; spacing: number };

const YELLOW = "0xFFE600";
const MIN_FONT = 16;

/**
 * drawtext options (without the `enable` window) and the line width to wrap at, for the hook or the captions.
 * At the default style the options are exactly what the renderer always used.
 */
export function styledText(
  kind: "hook" | "caption",
  base: TextBase,
  style: CaptionStyle,
  layout: "short" | "long",
): { wrap: number; options: string } {
  const k = style.scale;
  const minimal = kind === "caption" && style.preset === "minimal";
  const size = Math.max(MIN_FONT, Math.round(base.size * k * (minimal ? 0.85 : 1)));
  const spacing = Math.round(base.spacing * k);
  // Bigger letters fit fewer to a line, smaller ones more.
  const wrap = Math.max(6, Math.round(base.wrap / (k * (minimal ? 0.85 : 1))));

  let y = base.y;
  if (kind === "caption") {
    if (style.position === "middle") y = "(h-text_h)/2";
    else if (style.position === "top") y = layout === "short" ? "h*0.24" : "h*0.18"; // below the hook
  }

  const accent = style.preset === "yellow" ? YELLOW : "white";
  const border = Math.max(2, Math.round((base.border ?? Math.round(base.size * 0.1)) * k));
  let paint: string;
  if (kind === "hook") {
    // The hook is outlined text in every preset; the yellow preset also colours it.
    paint = `fontcolor=${accent}:borderw=${Math.round((base.border ?? 0) * (k === 1 ? 1 : k))}:bordercolor=black@0.9`;
  } else if (style.preset === "box") {
    paint = `fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=${Math.round((base.box ?? 0) * k)}`;
  } else if (style.preset === "minimal") {
    paint = `fontcolor=white:box=1:boxcolor=black@0.35:boxborderw=${Math.round((base.box ?? 0) * 0.6 * k)}`;
  } else {
    // outline and yellow: no box, a thick dark edge keeps the letters readable on any picture
    paint = `fontcolor=${accent}:borderw=${Math.max(border, Math.round(size * 0.12))}:bordercolor=black@0.95`;
  }
  return { wrap, options: `fontsize=${size}:${paint}:x=(w-text_w)/2:y=${y}:line_spacing=${spacing}` };
}
