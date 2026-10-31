// Node.js-only startup work, loaded from instrumentation.ts. Kept in its own file so the Edge bundle never sees
// the storage code (it uses process.cwd and fs). It only schedules timers, so it returns quickly.
//   AUTO_COLLECT=off  disables the performance collection timer.
//   COLLECT_INTERVAL_HOURS (default 6) and COLLECT_FIRST_DELAY_SEC (default 60) tune its timing.
//   AUTO_WEEKLY=off   disables the weekly "one-click preparation" check (it only runs if switched on in the app).

const g = globalThis as unknown as { __collectTimer?: ReturnType<typeof setInterval>; __weeklyTimer?: ReturnType<typeof setInterval> };

function scheduleCollection() {
  if (process.env.AUTO_COLLECT === "off" || g.__collectTimer) return; // dev reloads call register again

  const hours = Number(process.env.COLLECT_INTERVAL_HOURS);
  const intervalMs = (Number.isFinite(hours) && hours > 0 ? hours : 6) * 60 * 60_000;
  const delaySec = Number(process.env.COLLECT_FIRST_DELAY_SEC);
  const firstDelayMs = (Number.isFinite(delaySec) && delaySec >= 0 ? delaySec : 60) * 1000;

  const tick = async () => {
    try {
      const { collectOnce } = await import("./lib/channel/collector");
      await collectOnce(); // records its own errors in .data/collector.json
    } catch {
      /* never let a failed collection take the server down */
    }
  };
  setTimeout(tick, firstDelayMs).unref(); // first pass shortly after start
  g.__collectTimer = setInterval(tick, intervalMs);
  g.__collectTimer.unref();
}

/** Every 30 minutes, start the weekly preparation if a scheduled moment has passed since the last run. */
function scheduleWeekly() {
  if (process.env.AUTO_WEEKLY === "off" || g.__weeklyTimer) return;

  const tick = async () => {
    try {
      const { runWeeklyIfDue } = await import("./lib/channel/prepare");
      await runWeeklyIfDue(); // also catches up right after start if the computer was off at the scheduled time
    } catch {
      /* a failed check must never take the server down */
    }
  };
  setTimeout(tick, 90_000).unref();
  g.__weeklyTimer = setInterval(tick, 30 * 60_000);
  g.__weeklyTimer.unref();
}

export function registerNode() {
  if (process.env.NEXT_PUBLIC_DEMO === "1") return; // the public demo has no channel, no sign-in and nothing to collect
  scheduleCollection();
  scheduleWeekly();
}
