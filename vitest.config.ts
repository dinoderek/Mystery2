import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup-env.ts"],
    include: ["tests/**/*.test.ts"],
    exclude: [".claude/**", "**/node_modules/**", "**/dist/**"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json", "html"],
      reportsDirectory: "./coverage/api",
      include: [
        "supabase/functions/**/*.ts",
        "packages/shared/src/**/*.ts",
      ],
      exclude: ["**/*.test.ts", "**/node_modules/**", "**/*.d.ts"],
    },
  },
});
