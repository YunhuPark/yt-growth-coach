import type { NextConfig } from "next";

// The public demo (NEXT_PUBLIC_DEMO=1) never runs the video or speech code: src/proxy.ts answers every /api/* with a 403 first. Hosting
// such as Vercel limits a function to 250 MB, and the native speech engine and the bundled ffmpeg alone are about 370 MB, so they are
// left out of the traces of a demo build. A normal build and `next start` read node_modules directly and are not affected.
const DEMO_UNUSED = [
  ".data/**", // this computer's renders and downloaded models (not in git, so absent on a host, but present when building here)
  "node_modules/onnxruntime-node/**",
  "node_modules/onnxruntime-web/**",
  "node_modules/onnxruntime-common/**",
  "node_modules/@huggingface/**",
  "node_modules/ffmpeg-static/**",
  "node_modules/sharp/**",
  "node_modules/@img/**",
];

const nextConfig: NextConfig = {
  /* config options here */
  ...(process.env.NEXT_PUBLIC_DEMO === "1" ? { outputFileTracingExcludes: { "/*": DEMO_UNUSED } } : {}),
  // Native speech-recognition engine: load it from node_modules at runtime instead of bundling it.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
