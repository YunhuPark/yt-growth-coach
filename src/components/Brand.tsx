import Link from "next/link";

export const BRAND = "ClipLab";

/** The logo mark: a rounded square with a play triangle and a cut mark, drawn in SVG so it needs no image file. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={`${BRAND} 로고`}>
      <defs>
        <linearGradient id="cliplab-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#cliplab-g)" />
      <path d="M12 9.5v13l11-6.5z" fill="#fff" />
      <path d="M8 25.5h16" stroke="#fff" strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" strokeDasharray="5 3" />
    </svg>
  );
}

/** Logo and name, linking home. */
export default function Brand({ size = 32 }: { size?: number }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-extrabold tracking-tight">
      <LogoMark size={size} />
      <span className="text-lg">{BRAND}</span>
    </Link>
  );
}
