/**
 * The gate's steps, in one place so the runner and `./dev test` agree on their
 * names. A step's phase decides how it runs: phase 1 steps are independent and
 * run in parallel; phase 2 steps each start a server on the worktree's port,
 * so they run one after another and only once phase 1 is green.
 *
 * This is also the one list of where tests live. A step that runs test files
 * names its `roots` (repo-relative directories) and the `files` pattern its
 * runner collects, because a file under a root that the runner would not pick
 * up never runs. The Vitest steps build their command from the roots, so adding
 * a suite is one entry here. `gate-coverage.mjs` fails the gate on any test
 * file that no step runs.
 *
 * `integration` and `e2e-api` hand their roots to `scripts/run-mock-tests.mjs`,
 * which imports them from here. `e2e-browser`'s root describes the `testDir` in
 * `web/playwright.config.ts`.
 */

import path from "node:path";

/** What Vitest collects here: `vite.config.ts` and `vitest.config.ts` include `*.test.ts` only. */
const VITEST_FILES = /\.test\.ts$/;

/** Playwright's default `testMatch`, which `web/playwright.config.ts` leaves alone. */
const PLAYWRIGHT_FILES = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** A step that runs Vitest over `roots`, built from them. */
function vitestStep({ name, phase, roots, workspace }) {
  const filters = roots.map((root) =>
    workspace ? path.posix.relative(workspace, root) : root,
  );
  return {
    name,
    phase,
    roots,
    files: VITEST_FILES,
    args: [
      ...(workspace ? ["-w", workspace] : []),
      "exec",
      "--",
      "vitest",
      "run",
      ...filters,
      "--coverage",
    ],
  };
}

export const INTEGRATION_ROOTS = ["tests/api/integration"];
export const E2E_API_ROOTS = ["tests/api/e2e"];

export const GATE_STEPS = [
  // Phase 1: independent, run in parallel
  { name: "lint", phase: 1, args: ["run", "lint"] },
  { name: "typecheck", phase: 1, args: ["run", "typecheck"] },
  { name: "check-web", phase: 1, args: ["-w", "web", "run", "check"] },
  vitestStep({ name: "unit-api", phase: 1, roots: ["tests/api/unit"] }),
  vitestStep({
    name: "unit-web",
    phase: 1,
    roots: ["web/src/lib/domain"],
    workspace: "web",
  }),
  { name: "curated-docs", phase: 1, args: ["run", "check:curated-docs"] },
  { name: "doc-refs", phase: 1, args: ["run", "check:doc-refs"] },

  // Phase 2: each starts a server on the worktree's port, so serial
  {
    name: "integration",
    phase: 2,
    // `live-ai/` skips itself without live config; it is covered by path.
    roots: INTEGRATION_ROOTS,
    files: VITEST_FILES,
    args: ["run", "test:integration"],
  },
  {
    name: "e2e-api",
    phase: 2,
    roots: E2E_API_ROOTS,
    files: VITEST_FILES,
    args: ["run", "test:e2e"],
  },
  {
    name: "e2e-browser",
    phase: 2,
    roots: ["web/e2e"],
    files: PLAYWRIGHT_FILES,
    args: ["-w", "web", "run", "test:e2e"],
  },
];

/**
 * The steps to run: all of them when none is named, else only those named, in
 * gate order. An unknown name throws rather than running nothing, because a
 * typo that quietly runs no tests would read as a pass.
 *
 * @param {typeof GATE_STEPS} steps
 * @param {string[]} names
 */
export function selectSteps(steps, names) {
  if (names.length === 0) return steps;
  const known = steps.map((step) => step.name);
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown gate step: ${unknown.join(", ")}. Steps: ${known.join(", ")}.`,
    );
  }
  return steps.filter((step) => names.includes(step.name));
}
