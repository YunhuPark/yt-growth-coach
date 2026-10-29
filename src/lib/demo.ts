// The public demo: the same app built with NEXT_PUBLIC_DEMO=1. It keeps what runs entirely in the browser (the retention analysis) and
// the front page, and refuses everything that needs a server doing work for the visitor: video processing, the AI service, the Google
// sign-in. See src/proxy.ts for the refusal and README for how to build it. Inlined at build time.
export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

/** The tool that works in the demo. */
export const DEMO_TOOL = "retention";

export const DEMO_REFUSAL = "공개 데모에서는 쓸 수 없는 기능입니다. 내 컴퓨터에서 실행하면 모두 쓸 수 있어요.";
