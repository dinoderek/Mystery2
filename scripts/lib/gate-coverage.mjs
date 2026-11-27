/**
 * The gate-coverage check: every test file in the repo is run by a gate step
 * (under its roots, matching its `files` pattern, outside its `exclude`) or
 * declared by an opt-in suite, and never both, or the gate fails naming it.
 *
 * Without it a test file placed anywhere else passes when run by hand and is
 * never run by the gate, which is the worst kind of green.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * Test files git knows about: tracked, plus untracked files it does not ignore
 * (so a file that is not yet committed is caught), minus tracked files deleted
 * from the working tree.
 */
export function listTestFiles(repoRoot) {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\n")
    .filter((file) => file && TEST_FILE.test(file))
    .filter((file) => fs.existsSync(path.join(repoRoot, file)))
    .sort();
}

const under = (file, root) => file.startsWith(`${root.replace(/\/+$/, "")}/`);

/**
 * Whether `step` runs `file`: under one of its roots, matching its `files`
 * pattern, and under none of the roots it `exclude`s.
 */
function runs(step, file) {
  return (
    Boolean(step.files?.test(path.posix.basename(file))) &&
    (step.roots ?? []).some((root) => under(file, root)) &&
    !(step.exclude ?? []).some((root) => under(file, root))
  );
}

/** The test files in `files` that no step in `steps` runs. */
export function findUncoveredTestFiles(files, steps) {
  return files.filter(
    (file) => TEST_FILE.test(file) && !steps.some((step) => runs(step, file)),
  );
}

/**
 * The test files an opt-in suite declares that a gate step also runs. Each
 * would make the default gate run it, or report it skipped.
 */
export function findOptInFilesTheGateRuns(files, steps, optIn) {
  return files.filter(
    (file) =>
      optIn.some((suite) => runs(suite, file)) &&
      steps.some((step) => runs(step, file)),
  );
}

const plural = (n) => `${n} test file${n === 1 ? "" : "s"}`;

/**
 * Failure text for the gate log, or null when every test file is run by a
 * step or declared opt-in, and no opt-in file is also run by a step.
 */
export function describeUncovered(uncovered, steps, collidingOptIn = []) {
  const parts = [];
  if (uncovered.length > 0) {
    const roots = steps.flatMap((step) => step.roots ?? []);
    parts.push(
      `${plural(uncovered.length)} no gate step runs:`,
      ...uncovered.map((file) => `  ${file}`),
      `Move each under a suite the gate runs (${roots.join(", ")}), or declare its root in scripts/lib/gate-steps.mjs.`,
    );
  }
  if (collidingOptIn.length > 0) {
    parts.push(
      `${plural(collidingOptIn.length)} declared opt-in that a gate step also runs:`,
      ...collidingOptIn.map((file) => `  ${file}`),
      "Add the opt-in root to that step's `exclude` in scripts/lib/gate-steps.mjs.",
    );
  }
  return parts.length > 0 ? parts.join("\n") : null;
}
