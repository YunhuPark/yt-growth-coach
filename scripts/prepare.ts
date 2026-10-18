// Runs the one-click preparation without the web server:
//   npm run prepare              always run it
//   npm run prepare -- --if-due  only run it if the weekly schedule says it is due (for Windows Task Scheduler)
import { currentPrepare, runWeeklyIfDue, startPrepare, waitForPrepare } from "../src/lib/prepare";

async function main() {
  try {
    process.loadEnvFile(".env.local"); // API keys, same file the app uses
  } catch {
    /* env may already be set */
  }

  if (process.argv.includes("--if-due")) {
    if (!(await runWeeklyIfDue())) {
      console.log("건너뜀: 지금은 주간 준비 시간이 아니거나 이미 실행했습니다.");
      return;
    }
  } else {
    startPrepare({ trigger: "manual" });
  }

  const live = (await waitForPrepare()) ?? currentPrepare();
  for (const s of live?.steps ?? []) console.log(`${s.status.padEnd(8)} ${s.label}${s.detail ? ` — ${s.detail}` : ""}`);
  if (live?.status === "error") {
    console.error(`준비 실패: ${live.error}`);
    process.exit(1);
  }
  console.log("준비 완료");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
