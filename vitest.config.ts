import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "npm:zod": "zod",
    },
  },
  test: {
    setupFiles: ["./tests/setup-env.ts"],
    include: ["tests/**/*.test.ts"],
    exclude: [".claude/**", "**/node_modules/**", "**/dist/**"],
  },
});
