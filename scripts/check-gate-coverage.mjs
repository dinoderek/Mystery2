#!/usr/bin/env node
/**
 * Fails, naming each one, on a test file that no gate step runs. Part of phase
 * 1 of the gate (`npm run check:gate-coverage`). It checks against every gate
 * step, not only the ones a run selected, so running it alone gives the same
 * verdict as the full gate.
 */

import path from "node:path";
import process from "node:process";
import url from "node:url";

import {
  describeUncovered,
  findUncoveredTestFiles,
  listTestFiles,
} from "./lib/gate-coverage.mjs";
import { GATE_STEPS } from "./lib/gate-steps.mjs";

const REPO_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

function main() {
  const files = listTestFiles(REPO_ROOT);
  const report = describeUncovered(findUncoveredTestFiles(files, GATE_STEPS), GATE_STEPS);

  if (report === null) {
    process.stdout.write(`OK: ${files.length} test file(s), each under a gate step\n`);
    return;
  }
  process.stderr.write(`error: ${report}\n`);
  process.exit(1);
}

try {
  main();
} catch (err) {
  process.stderr.write(`fatal: could not list test files: ${err.message ?? err}\n`);
  process.exit(2);
}
