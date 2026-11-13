/**
 * The gate-coverage check: every test file in the repo sits under the roots of
 * a gate step, or the gate fails naming it.
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

/** The test files in `files` that no step's roots contain. */
export function findUncoveredTestFiles(files, steps) {
  const roots = steps.flatMap((step) => step.roots ?? []);
  return files.filter(
    (file) =>
      TEST_FILE.test(file) &&
      !roots.some((root) => file.startsWith(`${root.replace(/\/+$/, "")}/`)),
  );
}

/** Failure text for the gate log, or null when every test file is covered. */
export function describeUncovered(uncovered, steps) {
  if (uncovered.length === 0) return null;
  const roots = steps.flatMap((step) => step.roots ?? []);
  return [
    `${uncovered.length} test file${uncovered.length === 1 ? "" : "s"} no gate step runs:`,
    ...uncovered.map((file) => `  ${file}`),
    `Move each under a suite the gate runs (${roots.join(", ")}), or declare its root in scripts/lib/gate-steps.mjs.`,
  ].join("\n");
}
