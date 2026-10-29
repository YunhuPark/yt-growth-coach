import Link from "next/link";
import type { ReactNode } from "react";
import { DEMO } from "@/lib/shared/demo";
import Brand from "./Brand";

const LINKS: { href: string; label: string; id: "edit" | "channel" }[] = [
  { href: "/edit", label: "영상 편집", id: "edit" },
  { href: "/channel", label: "채널 분석", id: "channel" },
];

/** The bar at the top of every page: the brand on the left, where to go in the middle, whatever the page adds on the right. */
export default function SiteHeader({ active, children }: { active?: "edit" | "channel"; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-background/90 backdrop-blur">
      <a href="#main" className="sr-only rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-on-accent focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50">
        본문으로 건너뛰기
      </a>
      <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-4 py-3 sm:px-6">
        <Brand />
        <nav className="hidden items-center gap-5 sm:flex" aria-label="주요 메뉴">
          {LINKS.filter((l) => !DEMO || l.id !== "channel").map((l) => (
            <Link
              key={l.id}
              href={l.href}
              aria-current={active === l.id ? "page" : undefined}
              className={`border-b-2 py-1 text-sm font-medium ${active === l.id ? "border-foreground text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">{children}</div>
      </div>
    </header>
  );
}
