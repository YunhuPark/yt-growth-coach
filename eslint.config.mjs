import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Where code may reach, so the parts of the project stay separable (see README, "코드 구조"):
//
//   editor    video editing: the engine (src/lib/editor) and its screens (src/components/editor)
//   channel   channel analysis, recommendations, tracking (needs the Google sign-in)
//   shared    what both lean on: storage, usage metering, the Google and YouTube clients (src/lib/shared)
//   site      the page frame: logo, header, icons, the landing page (src/components/site)
//
//   editor  -> shared, site          never channel
//   channel -> editor, shared, site
//   shared  -> shared only
//   site    -> site only
//   and nothing under src/lib imports a component.
const rule = (patterns) => ({ "no-restricted-imports": ["error", { patterns }] });
const areas = (names, message) => ({ group: names.map((n) => `**/${n}/**`), message });
const NOT_CHANNEL = areas(["channel"], "The editor must not depend on the channel analysis. Pass what it needs in (see autoEditJobs' loadProfile).");
const NOT_EITHER = areas(["editor", "channel"], "Shared code and the page frame must not depend on the editor or the channel analysis.");
const NOT_COMPONENTS = { group: ["**/components/**", "@/components/**"], message: "Library code must not import components." };

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // one block per place, because a rule given twice for the same file is replaced, not merged
  { files: ["src/lib/editor/**/*.{ts,tsx}"], rules: rule([NOT_CHANNEL, NOT_COMPONENTS]) },
  { files: ["src/components/editor/**/*.{ts,tsx}"], rules: rule([NOT_CHANNEL]) },
  { files: ["src/lib/shared/**/*.{ts,tsx}"], rules: rule([NOT_EITHER, NOT_COMPONENTS]) },
  { files: ["src/components/site/**/*.{ts,tsx}"], rules: rule([NOT_EITHER]) },
  { files: ["src/lib/channel/**/*.{ts,tsx}"], rules: rule([NOT_COMPONENTS]) },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
