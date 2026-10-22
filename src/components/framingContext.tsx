"use client";

import { createContext, useContext, useState } from "react";
import type { Target } from "@/lib/reframe";

type Ctx = {
  /** vertical results from a wider video follow the person instead of showing the whole picture over a blurred copy */
  follow: boolean;
  smooth: number;
  target: Target;
  /** 1 = none, "auto" = fit the subject, or a number up to 3 */
  zoom: number | "auto";
  setFollow: (v: boolean) => void;
  setSmooth: (v: number) => void;
  setTarget: (v: Target) => void;
  setZoom: (v: number | "auto") => void;
};

// One choice per page, used by every render of a Short on it. Outside a provider nothing follows anyone, as before.
const FramingContext = createContext<Ctx>({ follow: false, smooth: 3, target: "person", zoom: 1, setFollow: () => {}, setSmooth: () => {}, setTarget: () => {}, setZoom: () => {} });

export function FramingProvider({ children }: { children: React.ReactNode }) {
  const [follow, setFollow] = useState(false);
  const [smooth, setSmooth] = useState(3);
  const [target, setTarget] = useState<Target>("person");
  const [zoom, setZoom] = useState<number | "auto">(1);
  return <FramingContext.Provider value={{ follow, smooth, target, zoom, setFollow, setSmooth, setTarget, setZoom }}>{children}</FramingContext.Provider>;
}

/** The `reframe` render option for the current choice, for a render in the given layout (undefined when it should not apply). */
export function useReframeOption(layout: "short" | "long"): { auto: true; smooth: number; target: Target; zoom: number | "auto" } | undefined {
  const { follow, smooth, target, zoom } = useContext(FramingContext);
  return follow && layout === "short" ? { auto: true, smooth, target, zoom } : undefined;
}

export const useFraming = () => useContext(FramingContext);
