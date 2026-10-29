import { getAnalysis } from "./analysis";
import {
  loadCollector,
  loadEvents,
  loadTokens,
  loadTracking,
  saveCollector,
  saveEvents,
  saveTracking,
  type CollectEvent,
  type CollectorState,
  type TrackEntry,
} from "../shared/store";
import { CHECKPOINTS, evaluate, freezeCheckpoint, getBaseline, summarizeCheckpoint } from "./tracking";

export type CollectSummary = {
  skipped?: string;
  newVideos: number;
  newEvents: number;
  checked: number;
  error?: string;
};

// One collection at a time, whether it was triggered by the timer, the CLI, or the button.
const g = globalThis as unknown as { __collecting?: Promise<CollectSummary> };

export function collectOnce(): Promise<CollectSummary> {
  if (g.__collecting) return g.__collecting;
  g.__collecting = run().finally(() => {
    g.__collecting = undefined;
  });
  return g.__collecting;
}

async function run(): Promise<CollectSummary> {
  if (!(await loadTokens())) return { skipped: "YouTube 계정이 연결되지 않았습니다.", newVideos: 0, newEvents: 0, checked: 0 };

  const state = await loadCollector();
  const now = new Date().toISOString();
  try {
    const a = await getAnalysis(true);
    const entries = await loadTracking();
    const events = await loadEvents();
    const fresh: CollectEvent[] = [];
    const push = (e: Omit<CollectEvent, "id" | "at" | "read">) => {
      const id = `${e.videoId}:${e.type}:${e.n ?? 0}`;
      if (events.some((x) => x.id === id) || fresh.some((x) => x.id === id)) return;
      fresh.push({ ...e, id, at: now, read: false });
    };

    // 1) New uploads. The first run only records what already exists, so old videos aren't treated as new.
    const firstRun = !state.seen;
    const seen = new Set(state.seen ?? []);
    const tracked = new Set(entries.map((e) => e.videoId));
    let newVideos = 0;
    for (const v of a.videos) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      if (firstRun || tracked.has(v.id)) continue;
      const entry: TrackEntry = {
        videoId: v.id,
        title: v.title,
        publishedAt: v.publishedAt,
        format: v.format,
        levers: [],
        note: "자동 감지",
        linkedAt: now,
        auto: true,
      };
      entries.unshift(entry);
      newVideos++;
      push({
        type: "new_video",
        videoId: v.id,
        title: v.title,
        text: "새 영상을 감지해 추적을 시작했습니다. 성과 추적 탭에서 시도한 요소를 체크해 주세요.",
      });
    }

    // 2) Record each checkpoint the first time it becomes final.
    let checked = 0;
    const pending = entries.filter((e) => CHECKPOINTS.some((n) => !e.frozen?.[String(n)]));
    if (pending.length) {
      const baseline = await getBaseline(a.videos);
      for (const entry of pending) {
        checked++;
        const ev = await evaluate(entry, baseline, true);
        for (const c of ev.checkpoints) {
          if (entry.frozen?.[String(c.n)]) continue;
          const frozen = freezeCheckpoint(c, now);
          if (!frozen) continue;
          entry.frozen = { ...entry.frozen, [String(c.n)]: frozen };
          push({ type: "checkpoint", videoId: entry.videoId, title: entry.title, n: c.n, text: `${c.n}일차 결과 — ${summarizeCheckpoint(c)}` });
        }
      }
    }

    await saveTracking(entries);
    await saveEvents([...fresh, ...events]);
    const next: CollectorState = {
      lastRunAt: now,
      lastResult: { newVideos, newEvents: fresh.length, checked },
      seen: [...seen],
    };
    await saveCollector(next);
    return { newVideos, newEvents: fresh.length, checked };
  } catch (e) {
    const error = e instanceof Error ? e.message : "알 수 없는 오류";
    await saveCollector({ ...state, lastRunAt: now, lastError: error });
    return { newVideos: 0, newEvents: 0, checked: 0, error };
  }
}
