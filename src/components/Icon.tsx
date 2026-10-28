import type { ReactNode, SVGProps } from "react";

export type IconName = "clapper" | "timeline" | "scissors" | "frame" | "link" | "type" | "wave" | "film" | "check" | "arrow";

// Plain line icons on a 24 px grid, drawn here so the interface needs no icon font or emoji (emoji look different on every system).
const PATHS: Record<IconName, ReactNode> = {
  clapper: (
    <>
      <path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9Z" />
      <path d="m4 9 1.6-4.2 14 1.2-.6 3M8.5 5.6l2.6 3.2M13.5 6l2.6 3" />
    </>
  ),
  timeline: (
    <>
      <path d="M3 7h18M3 12h18M3 17h18" />
      <path d="M8 5v4M15 10v4M11 15v4" strokeWidth="2.4" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="6.5" r="2.5" />
      <circle cx="6" cy="17.5" r="2.5" />
      <path d="M8 8.2 20 18M8 15.8 20 6" />
    </>
  ),
  frame: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="1.5" />
      <path d="M3 8V5.5A1.5 1.5 0 0 1 4.5 4M21 8V5.5A1.5 1.5 0 0 0 19.5 4M3 16v2.5A1.5 1.5 0 0 0 4.5 20M21 16v2.5a1.5 1.5 0 0 1-1.5 1.5" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" />
    </>
  ),
  type: (
    <>
      <path d="M5 6V4.5h14V6M12 4.5V20M9 20h6" />
    </>
  ),
  wave: (
    <>
      <path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 10v4M21 12h0" />
    </>
  ),
  film: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M8 3v18M16 3v18M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
};

/** A stroke icon at the current text colour. Decorative unless given a `title`. */
export default function Icon({ name, size = 20, title, ...rest }: { name: IconName; size?: number; title?: string } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
