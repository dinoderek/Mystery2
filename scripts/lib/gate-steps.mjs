/**
 * The gate's steps, and the test roots each one runs.
 *
 * This is the one list of where tests live. A step that runs test files names
 * them in `roots` (repo-relative directories), and for the Vitest steps the
 * command is built from those roots, so adding a suite is one entry here.
 * `gate-coverage.mjs` fails the gate on any test file under no step's roots.
 *
 * `integration`, `e2e-api` and `e2e-browser` hand their paths to scripts that
 * own them (`scripts/run-mock-tests.mjs`, `web/playwright.config.ts`); their
 * roots here describe what those scripts run.
 */

import path from "node:path";

/** Vitest arguments for `roots`, relative to the workspace the step runs in. */
function vitestArgs(roots, workspace) {
  const filters = roots.map((root) =>
    workspace ? path.posix.relative(workspace, root) : root,
  );
  return [
    ...(workspace ? ["-w", workspace] : []),
    "exec",
    "--",
    "vitest",
    "run",
    ...filters,
    "--coverage",
  ];
}

export const STEPS = [
  // Phase 1 — independent, run in parallel
  { name: "lint", phase: 1, args: ["run", "lint"] },
  { name: "typecheck", phase: 1, args: ["run", "typecheck"] },
  { name: "check-web", phase: 1, args: ["-w", "web", "run", "check"] },
  {
    name: "unit-api",
    phase: 1,
    roots: ["tests/api/unit"],
    get args() {
      return vitestArgs(this.roots);
    },
  },
  {
    name: "unit-web",
    phase: 1,
    roots: ["web/src/lib/domain"],
    get args() {
      return vitestArgs(this.roots, "web");
    },
  },
  { name: "curated-docs", phase: 1, args: ["run", "check:curated-docs"] },
  { name: "doc-refs", phase: 1, args: ["run", "check:doc-refs"] },

  // Phase 2 — each starts a server on the worktree's port, so serial
  {
    name: "integration",
    phase: 2,
    // `live-ai/` skips itself without live config; it is covered by path.
    roots: ["tests/api/integration"],
    args: ["run", "test:integration"],
  },
  {
    name: "e2e-api",
    phase: 2,
    roots: ["tests/api/e2e"],
    args: ["run", "test:e2e"],
  },
  {
    name: "e2e-browser",
    phase: 2,
    roots: ["web/e2e"],
    args: ["-w", "web", "run", "test:e2e"],
  },
];
