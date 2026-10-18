// Runs once when the Next.js server starts. The timers live in instrumentation-node.ts (see the notes there):
//   AUTO_COLLECT=off  disables the performance collection timer.
//   COLLECT_INTERVAL_HOURS (default 6) and COLLECT_FIRST_DELAY_SEC (default 60) tune its timing.
//   AUTO_WEEKLY=off   disables the weekly "one-click preparation" check (it only runs if switched on in the app).

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerNode } = await import("./instrumentation-node");
  registerNode();
}
