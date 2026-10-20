import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
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
