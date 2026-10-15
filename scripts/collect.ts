// Runs one collection without the web server, e.g. from Windows Task Scheduler:  npm run collect
import { collectOnce } from "../src/lib/collector";

async function main() {
  try {
    process.loadEnvFile(".env.local"); // API keys, same file the app uses
  } catch {
    /* env may already be set */
  }

  const r = await collectOnce();
  if (r.skipped) {
    console.log(`건너뜀: ${r.skipped}`);
  } else if (r.error) {
    console.error(`수집 실패: ${r.error}`);
    process.exit(1);
  } else {
    console.log(`수집 완료 — 새 영상 ${r.newVideos}개, 새 알림 ${r.newEvents}개, 확인한 영상 ${r.checked}개`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
