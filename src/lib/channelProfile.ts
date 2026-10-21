import { getAnalysis } from "./analysis";
import { buildClipProfile, type ClipProfile } from "./clipProfile";

/** What has worked on the signed-in channel's Shorts. Rejects when the channel can't be read; callers carry on without it. */
export async function loadClipProfile(): Promise<ClipProfile | null> {
  const a = await getAnalysis();
  return buildClipProfile(a.videos, a.patterns);
}
