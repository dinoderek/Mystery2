import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "scripts/**",
      "evaluation/**", // top-level evaluation pipeline (Node CLI utilities)
      ".claude/**", // local agent worktrees
      "**/build/**",
      "**/coverage/**",
      "**/*.min.js",
      "**/.svelte-kit/**",
      "**/playwright-report/**"
    ],
  },
);
