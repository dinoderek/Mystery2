import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "supabase/functions/**", // Handled by deno lint
      "scripts/**",
      ".specify/**", // speckit
      ".agent/**", // speckit
      ".claude/**", // local agent worktrees
      "**/build/**",
      "**/coverage/**",
      "**/*.min.js",
      "**/.svelte-kit/**",
      "**/playwright-report/**"
    ],
  },
);
