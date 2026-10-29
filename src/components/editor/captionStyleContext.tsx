"use client";

import { createContext, useContext, useState } from "react";
import { DEFAULT_STYLE, type CaptionStyle } from "@/lib/editor/captionStyle";

type Ctx = { style: CaptionStyle; setStyle: (s: CaptionStyle) => void };

// One caption style per page, chosen once and used by every render on it. Outside a provider the default is used.
const StyleContext = createContext<Ctx>({ style: DEFAULT_STYLE, setStyle: () => {} });

export function CaptionStyleProvider({ children }: { children: React.ReactNode }) {
  const [style, setStyle] = useState<CaptionStyle>(DEFAULT_STYLE);
  return <StyleContext.Provider value={{ style, setStyle }}>{children}</StyleContext.Provider>;
}

export const useCaptionStyle = () => useContext(StyleContext);
