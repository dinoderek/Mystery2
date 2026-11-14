#!/usr/bin/env node
/**
 * Fails, naming the project and measure, when unit coverage is below its floor
 * in `coverage-floors.json`, or when a project has no report. Part of phase 1
 * of the gate (`npm run check:coverage-floors`): it reads the reports the
 * `unit-api` and `unit-web` steps write, so the gate runs it after them.
 */

import path from "node:path";
import process from "node:process";
import url from "node:url";

import {
  checkFloors,
  describeFailures,
  describeResults,
} from "./lib/coverage-floors.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  "..",
);

try {
  const results = checkFloors(REPO_ROOT);
  const failures = describeFailures(results);
  if (failures === null) {
    process.stdout.write(
      `OK: every measure meets its floor\n${describeResults(results)}\n`,
    );
  } else {
    process.stderr.write(`error: coverage below its floor\n${failures}\n`);
    process.exit(1);
  }
} catch (err) {
  process.stderr.write(`fatal: ${err.message ?? err}\n`);
  process.exit(2);
}
