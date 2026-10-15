// Runs once when the Next.js server starts. It must return quickly, so it only schedules the work.
// AUTO_COLLECT=off disables it. COLLECT_INTERVAL_HOURS (default 6) and COLLECT_FIRST_DELAY_SEC (default 60) tune the timing.

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.AUTO_COLLECT === "off") return;

  const g = globalThis as unknown as { __collectTimer?: ReturnType<typeof setInterval> };
  if (g.__collectTimer) return; // dev reloads call register again

  const hours = Number(process.env.COLLECT_INTERVAL_HOURS);
  const intervalMs = (Number.isFinite(hours) && hours > 0 ? hours : 6) * 60 * 60_000;
  const delaySec = Number(process.env.COLLECT_FIRST_DELAY_SEC);
  const firstDelayMs = (Number.isFinite(delaySec) && delaySec >= 0 ? delaySec : 60) * 1000;

  const tick = async () => {
    try {
      const { collectOnce } = await import("./lib/collector");
      await collectOnce(); // records its own errors in .data/collector.json
    } catch {
      /* never let a failed collection take the server down */
    }
  };
  setTimeout(tick, firstDelayMs).unref(); // first pass shortly after start
  g.__collectTimer = setInterval(tick, intervalMs);
  g.__collectTimer.unref();
}
