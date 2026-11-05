"use client";

import { useEffect, useRef } from "react";

/**
 * A silent screen recording of the tool at work. It starts by itself and loops, unless the visitor has asked their system for less
 * motion; the player's own controls let anyone pause it (a moving picture that starts alone has to be stoppable).
 */
export default function TourVideo({ src, poster, label, caption }: { src: string; poster: string; label: string; caption: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    v.play().catch(() => {
      /* autoplay refused (battery saver and the like): the poster and the controls are still there */
    });
  }, []);

  return (
    <figure className="flex flex-col gap-3">
      <video
        ref={ref}
        className="h-auto w-full rounded-[10px] border border-line bg-card"
        width={960}
        height={540}
        muted
        loop
        playsInline
        controls
        preload="metadata"
        poster={poster}
        aria-label={label}
      >
        <source src={src} type="video/mp4" />
        이 브라우저에서는 영상을 재생할 수 없습니다.
      </video>
      <figcaption className="text-sm font-medium text-muted">{caption}</figcaption>
    </figure>
  );
}
