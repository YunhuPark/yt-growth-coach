// Pure helpers, kept free of server-only imports so the browser can use them too.

/** Relative difference between a supplied file's length and the original video's, as a fraction of the original. */
export const lengthMismatch = (fileSec: number, originalSec: number) => Math.abs(fileSec - originalSec) / Math.max(1, originalSec);

/** More than this and the file is probably not the same video (a cut, a re-edit, a different version), so times may not line up. */
export const MISMATCH_LIMIT = 0.05;
