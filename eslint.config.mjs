import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The Node scripts and evaluation harnesses are plain ES modules.
    files: ["evaluation/**/*.mjs", "scripts/**/*.mjs", "lib/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      ".claude/**", // local agent worktrees
      "**/build/**",
      "**/coverage/**",
      "**/*.min.js",
      "**/.svelte-kit/**",
      "**/playwright-report/**"
    ],
  },
);
