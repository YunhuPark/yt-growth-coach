"use client";

import { createContext, useContext, useState } from "react";
import { DEFAULT_EFFECTS, hasEffects, type EffectsOpts } from "@/lib/editor/effects";

type Ctx = { effects: EffectsOpts; setEffects: (e: EffectsOpts) => void };

// One choice per page, used by every render on it. Outside a provider nothing is added, as before.
const EffectsContext = createContext<Ctx>({ effects: DEFAULT_EFFECTS, setEffects: () => {} });

export function EffectsProvider({ children }: { children: React.ReactNode }) {
  const [effects, setEffects] = useState<EffectsOpts>(DEFAULT_EFFECTS);
  return <EffectsContext.Provider value={{ effects, setEffects }}>{children}</EffectsContext.Provider>;
}

export const useEffects = () => useContext(EffectsContext);

/** The `effects` render option for the current choice; undefined when nothing is asked for. */
export function useEffectsOption(): EffectsOpts | undefined {
  const { effects } = useContext(EffectsContext);
  return hasEffects(effects) ? effects : undefined;
}
