import { execSync } from "node:child_process";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";

function getWorktreeMainRepoRoot(): string | undefined {
  try {
    const gitDir = execSync("git rev-parse --git-dir", {
      encoding: "utf-8",
    }).trim();
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      encoding: "utf-8",
    }).trim();
    if (gitDir !== gitCommonDir) {
      // We're in a worktree — resolve the main repo root from the common dir
      return resolve(gitCommonDir, "..");
    }
  } catch {
    // Not a git repo or git not available — ignore
  }
  return undefined;
}

const mainRepoRoot = getWorktreeMainRepoRoot();

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    // Explicit IPv4. `localhost` resolves to ::1 first on some machines, and
    // then a client that reaches for 127.0.0.1 — Playwright's `page.request`,
    // curl, the test server's readiness probe — is refused by a server that is
    // demonstrably up.
    host: "127.0.0.1",
    ...(mainRepoRoot ? { fs: { allow: [mainRepoRoot] } } : {}),
  },
  test: {
    include: ["src/lib/domain/**/*.test.ts"],
    environment: "node",
    globals: true,
    passWithNoTests: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json", "json-summary", "html"],
      reportsDirectory: "./coverage",
      include: ["src/lib/**/*.ts", "src/lib/**/*.svelte"],
      exclude: ["**/*.test.ts", "**/node_modules/**"],
    },
  },
});
