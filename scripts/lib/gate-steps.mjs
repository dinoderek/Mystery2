/**
 * The gate's steps, in one place so the runner and `./dev test` agree on their
 * names. A step's phase decides how it runs: phase 1 steps are independent and
 * run in parallel, except that a step naming `after` waits for those steps to
 * finish; phase 2 steps each start a server on the worktree's port, so they run
 * one after another and only once phase 1 is green.
 *
 * This is also the one list of where tests live. A step that runs test files
 * names its `roots` (repo-relative directories) and the `files` pattern its
 * runner collects, because a file under a root that the runner would not pick
 * up never runs. The Vitest steps build their command from the roots, so adding
 * a suite is one entry here. `gate-coverage.mjs` fails the gate on any test
 * file that no step runs.
 *
 * `integration` and `e2e-api` hand their roots and `exclude` to
 * `scripts/run-mock-tests.mjs`, which imports them from here. `e2e-browser`'s
 * root describes the `testDir` in `web/playwright.config.ts`.
 *
 * Suites that call a real model are opt-in: `OPT_IN_SUITES` names them, the
 * gate steps that would otherwise collect them `exclude` them, and the gate
 * lists them under its verdict without running them. So a default gate reports
 * no skipped test.
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

const INTEGRATION_ROOTS = ["tests/api/integration"];
const E2E_API_ROOTS = ["tests/api/e2e"];
/** The live-AI suites, by the suite name `scripts/run-live-ai.mjs` takes. */
export const LIVE_AI_ROOTS = {
  integration: "tests/api/integration/live-ai",
  e2e: "tests/api/e2e/live-ai",
};
const LAUNCHER_ROOTS = ["tests/api/launcher"];

export const GATE_STEPS = [
  // Phase 1: independent, run in parallel
  { name: "lint", phase: 1, args: ["run", "lint"] },
  { name: "typecheck", phase: 1, args: ["run", "typecheck"] },
  { name: "check-web", phase: 1, args: ["-w", "web", "run", "check"] },
  { name: "quality", phase: 1, args: ["run", "check:quality"] },
  { name: "imports", phase: 1, args: ["run", "check:imports"] },
  vitestStep({ name: "unit-api", phase: 1, roots: ["tests/api/unit"] }),
  vitestStep({
    name: "unit-web",
    phase: 1,
    roots: ["web/src/lib/domain", "web/src/lib/api"],
    workspace: "web",
  }),
  { name: "doc-refs", phase: 1, args: ["run", "check:doc-refs"] },
  { name: "word-budgets", phase: 1, args: ["run", "check:word-budgets"] },
  { name: "gate-coverage", phase: 1, args: ["run", "check:gate-coverage"] },
  { name: "tracked-files", phase: 1, args: ["run", "check:tracked-files"] },
  // Reads the reports the two unit steps write, so it starts once they finish.
  {
    name: "coverage-floors",
    phase: 1,
    after: ["unit-api", "unit-web"],
    args: ["run", "check:coverage-floors"],
  },

  // Phase 2: each starts a server on the worktree's port, so serial
  {
    name: "integration",
    phase: 2,
    roots: INTEGRATION_ROOTS,
    exclude: [LIVE_AI_ROOTS.integration],
    files: VITEST_FILES,
    args: ["run", "test:integration"],
  },
  {
    name: "e2e-api",
    phase: 2,
    roots: E2E_API_ROOTS,
    exclude: [LIVE_AI_ROOTS.e2e],
    files: VITEST_FILES,
    args: ["run", "test:e2e"],
  },
  // The real launcher (`scripts/dev.mjs --db prod`) under the mock narrator, on
  // a temporary config root: a recorded playtest from start to judged bundle.
  // Its own server, so no suite build; no coverage, so the unit reports stand.
  {
    name: "e2e-launcher",
    phase: 2,
    roots: LAUNCHER_ROOTS,
    files: VITEST_FILES,
    args: ["exec", "--", "vitest", "run", ...LAUNCHER_ROOTS],
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
 * Suites the gate never runs, because they call a real model and need one
 * named. Each is covered for `gate-coverage` by its `roots`, and listed under
 * the gate's verdict with the `command` that runs it.
 */
export const OPT_IN_SUITES = [
  {
    name: "live-integration",
    roots: [LIVE_AI_ROOTS.integration],
    files: VITEST_FILES,
    command: "npm run test:integration:live -- <ai>",
  },
  {
    name: "live-e2e",
    roots: [LIVE_AI_ROOTS.e2e],
    files: VITEST_FILES,
    command: "npm run test:e2e:live -- <ai>",
  },
];

/** The lines `summary.log` prints after the verdict: each opt-in suite and its command. */
export function formatOptInSuites(suites = OPT_IN_SUITES) {
  return [
    "Opt-in, not run by the gate (each calls the AI named in ai.json):",
    ...suites.map((suite) => `${suite.name.padEnd(16)} ${suite.command}`),
  ];
}

/** Vitest `--exclude` globs for a step's excluded roots. */
export function excludeArgs(step) {
  return (step.exclude ?? []).flatMap((root) => ["--exclude", `${root}/**`]);
}

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
