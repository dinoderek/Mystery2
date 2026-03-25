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
  server: mainRepoRoot
    ? { fs: { allow: [mainRepoRoot] } }
    : undefined,
  test: {
    include: ["src/lib/domain/**/*.test.ts"],
    environment: "node",
    globals: true,
    passWithNoTests: false,
  },
});
