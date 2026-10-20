import { loadClips, saveClips, type ClipRecord } from "./store";
import { parseVideoId } from "./util";

// Shorts made from AI candidates, kept so each can later be linked to the video it became (see clipValidation.ts).

export type ClipInput = Omit<ClipRecord, "at" | "videoId" | "linkedAt">;

const text = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

/** Records a rendered candidate. Calling it again for the same render replaces the entry but keeps an existing link. */
export async function registerClip(input: ClipInput): Promise<ClipRecord> {
  const all = await loadClips();
  const prev = all.find((c) => c.id === input.id);
  const rec: ClipRecord = {
    id: input.id,
    at: prev?.at ?? new Date().toISOString(),
    sourceName: text(input.sourceName, 200),
    aiScore: Math.min(10, Math.max(1, input.aiScore)),
    reason: text(input.reason, 300),
    title: text(input.title, 120),
    hook: text(input.hook, 80),
    start: input.start,
    end: input.end,
    lengthFit: input.lengthFit ?? null,
    videoId: prev?.videoId,
    linkedAt: prev?.linkedAt,
  };
  await saveClips([rec, ...all.filter((c) => c.id !== input.id)].slice(0, 300));
  return rec;
}

export class LinkError extends Error {}

/** Links a clip to an uploaded video (id or any YouTube URL), or unlinks it with null. One video belongs to one clip. */
export async function linkClip(id: string, video: string | null): Promise<ClipRecord> {
  const all = await loadClips();
  const clip = all.find((c) => c.id === id);
  if (!clip) throw new LinkError("쇼츠 기록을 찾지 못했습니다.");
  if (video === null || video.trim() === "") {
    clip.videoId = undefined;
    clip.linkedAt = undefined;
  } else {
    const videoId = parseVideoId(video);
    if (!videoId) throw new LinkError("유튜브 영상 주소나 영상 ID를 알아볼 수 없습니다.");
    const taken = all.find((c) => c.videoId === videoId && c.id !== id);
    if (taken) throw new LinkError(`이 영상은 이미 다른 쇼츠(“${taken.title || taken.hook || taken.id}”)에 연결되어 있습니다.`);
    clip.videoId = videoId;
    clip.linkedAt = new Date().toISOString();
  }
  await saveClips(all);
  return clip;
}

export async function deleteClip(id: string) {
  await saveClips((await loadClips()).filter((c) => c.id !== id));
}
