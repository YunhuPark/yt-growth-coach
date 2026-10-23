import Link from "next/link";
import type { ReactNode } from "react";
import Brand from "./Brand";

const LINKS: { href: string; label: string; id: "edit" | "channel" }[] = [
  { href: "/edit", label: "영상 편집", id: "edit" },
  { href: "/channel", label: "채널 분석", id: "channel" },
];

/** The bar at the top of every page: the brand on the left, where to go in the middle, whatever the page adds on the right. */
export default function SiteHeader({ active, children }: { active?: "edit" | "channel"; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
        <Brand />
        <nav className="ml-2 hidden items-center gap-1 sm:flex" aria-label="주요 메뉴">
          {LINKS.map((l) => (
            <Link
              key={l.id}
              href={l.href}
              aria-current={active === l.id ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${active === l.id ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground"}`}
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
