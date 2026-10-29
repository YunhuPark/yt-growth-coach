# ClipLab design rules

How the interface should look, for anyone (or any coding agent) changing it. The tokens live in `src/app/globals.css`; the brand name in
`src/components/site/Brand`.

## Direction

Editorial and film-like, and quiet: the tool's own screens and the user's video are the content, the interface steps back. Two reference
systems informed it (read from the MIT-licensed [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) collection): Runway
(one typeface, tight display type, no shadows, no decorative colour) and Cal.com (monochrome actions, hairline borders, show the real
product instead of drawing illustrations of it). No code or assets were copied from either, and nothing from the AGPL or
unclear-licence libraries that were considered.

## Colour

| Role | Light | Dark |
|---|---|---|
| Paper (page) | `#f6f4ef` | `#0d0d0c` |
| Card | `#fbfaf7` | `#151513` |
| Ink (text, actions, selection) | `#14130f` | `#f1eee6` |
| Hairline | `#ddd9cf` | `#2a2926` |
| Muted text | `#6a665d` | `#9a968b` |
| Marker yellow (the one decorative colour) | `#f2c200` | same |
| Green: "stays on this computer", success | `#1f6f43` | `#5bc98a` |
| Red: errors only | `#b3261e` | `#f2766e` |

- Actions are ink: the primary button is black on paper (paper on black in dark mode). Selection is a 1 px ink border, not a tint.
- Marker yellow marks **"uses the AI service"** (`.chip-ai`) and the one highlighted phrase in a hero headline (`.mark`). Nowhere else.
- No gradients (the film-strip `.sprockets` and the highlighter are the only exceptions, both hard-edged), no shadows, no purple, no emoji.

## Type

- One family (system Korean stack: Pretendard, Noto Sans KR, Apple SD Gothic Neo, Malgun Gothic). Weights 400, 600, 700.
- Headings: bold, tracking `-0.03em`, tight leading (1.05-1.1 for display). Body: 15-17 px, leading 1.55.
- Numbers that behave like film timecode (step counters, times, scores) use the mono stack via `.timecode`. Keep Korean text out of mono:
  small letter-spaced Korean in a monospace fallback looks broken.
- Korean breaks between words (`word-break: keep-all`).

## Shape and layout

- Radius 6-10 px (`rounded-lg` for controls, `rounded-[10px]` for cards). Never pills, never 2xl.
- Hairline borders carry structure; sections are separated by whitespace and rules, not by boxes within boxes.
- The landing page alternates paper, a faint band, paper, and ends on one inverted (ink) band. Do not add other dark blocks.
- A film-strip band (`.sprockets`) may divide the hero from the page, and open the closing band. That is the only ornament.
- The editor is a walk of four screens with a stepper (square numbered markers joined by a hairline). Back and next are at the bottom of
  each screen; next says why it is disabled when it is.

## Content

- Show the product itself (`ProductFragment` in `Landing.tsx`: real parts, made-up numbers, and it says so) instead of drawing a phone or
  an illustration.
- Every tool starts with `ToolIntro`: a one-line summary, three numbered steps, the AI/local badge, and the long explanation folded under
  "자세한 설명".
- Icons are the stroke icons in `Icon.tsx`.

## Don't

- Don't use purple, gradients, glow, glassy cards, floating decorative badges, or emoji as icons.
- Don't use colour to decorate. Yellow means AI, green means local, red means error; everything else is ink and paper.
- Don't add a second typeface or weights above 700.
