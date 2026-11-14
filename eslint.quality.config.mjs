// Per-function quality limits, checked by `npm run check:quality`. Separate
// from `eslint.config.mjs` so `lint` stays free of suppressions. Offenders that
// predate the limits sit in `quality-baseline.json`; see `docs/testing.md`.
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

export default tseslint.config({
  files: [
    "packages/game-engine/**/*.ts",
    "packages/shared/**/*.ts",
    "web/src/**/*.ts",
    "evaluation/**/*.{ts,mjs}",
    "scripts/**/*.mjs",
    "lib/**/*.mjs",
  ],
  ignores: ["**/*.test.ts", "**/node_modules/**", "**/dist/**"],
  extends: [tseslint.configs.base],
  linterOptions: { reportUnusedDisableDirectives: "off" },
  plugins: { sonarjs },
  rules: {
    "sonarjs/cognitive-complexity": ["error", 25],
    "max-lines-per-function": ["error", { max: 200 }],
    "max-depth": ["error", 4],
    "max-params": ["error", 5],
  },
});
