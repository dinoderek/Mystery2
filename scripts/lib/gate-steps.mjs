/**
 * The gate's steps, in one place so the runner and `./dev test` agree on their
 * names. A step's phase decides how it runs: phase 1 steps are independent and
 * run in parallel; phase 2 steps each start a server on the worktree's port,
 * so they run one after another and only once phase 1 is green.
 */

export const GATE_STEPS = [
  // Phase 1: independent, run in parallel
  { name: "lint", phase: 1, args: ["run", "lint"] },
  { name: "typecheck", phase: 1, args: ["run", "typecheck"] },
  { name: "check-web", phase: 1, args: ["-w", "web", "run", "check"] },
  { name: "unit-api", phase: 1, args: ["run", "test:unit:coverage"] },
  {
    name: "unit-web",
    phase: 1,
    args: ["-w", "web", "run", "test:unit:coverage"],
  },
  { name: "curated-docs", phase: 1, args: ["run", "check:curated-docs"] },
  { name: "doc-refs", phase: 1, args: ["run", "check:doc-refs"] },

  // Phase 2: each starts a server on the worktree's port, so serial
  { name: "integration", phase: 2, args: ["run", "test:integration"] },
  { name: "e2e-api", phase: 2, args: ["run", "test:e2e"] },
  { name: "e2e-browser", phase: 2, args: ["-w", "web", "run", "test:e2e"] },
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
