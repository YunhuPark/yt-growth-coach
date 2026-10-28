import Link from "next/link";

export const BRAND = "ClipLab";

/** The logo mark: a clapper board in two colours of the page, with a marker-yellow stripe. Drawn in SVG, so it needs no image file. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={`${BRAND} 로고`}>
      <rect width="32" height="32" rx="7" fill="var(--foreground)" />
      <path d="M6 12.5h20" stroke="var(--marker)" strokeWidth="3.2" />
      <path d="M6 12.5 8.4 7.5M12 12.5l2.4-5M18 12.5l2.4-5M24 12.5l2-4.2" stroke="var(--background)" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="6.5" y="15.5" width="19" height="10" rx="1.5" fill="none" stroke="var(--background)" strokeWidth="1.6" />
    </svg>
  );
}

/** Logo and name, linking home. */
export default function Brand({ size = 30 }: { size?: number }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight">
      <LogoMark size={size} />
      <span className="text-[17px] tracking-[-0.03em]">{BRAND}</span>
    </Link>
  );
}
