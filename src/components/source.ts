import type { Basis } from "./shared";

/** The video the creator is working on, chosen once and shared by every tool on the page. */
export type SourceState = {
  file: File | null;
  /** an absolute path on this computer, for files too big to upload */
  sourcePath: string;
  basis: Basis | "";
  confirmed: boolean;
};

export const EMPTY_SOURCE: SourceState = { file: null, sourcePath: "", basis: "", confirmed: false };

export const hasSource = (s: SourceState) => !!s.file || !!s.sourcePath.trim();

/** A file or path is chosen and the rights confirmation is done: the condition for anything that reads the video. */
export const sourceReady = (s: SourceState) => hasSource(s) && s.confirmed && !!s.basis;

/** Name to show for the chosen video. */
export const sourceName = (s: SourceState) => s.file?.name ?? (s.sourcePath.trim().split(/[\\/]/).pop() || "");
