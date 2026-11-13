#!/usr/bin/env node
/**
 * Fails when an import breaks a layer rule that the baseline does not list, or
 * when a baseline entry no longer applies. Part of phase 1 of the gate (`npm
 * run check:imports`). `--prune` rewrites the baseline without its stale
 * entries; it never adds one.
 */

import path from "node:path";
import process from "node:process";
import url from "node:url";

import {
  compareToBaseline,
  describeDiff,
  findViolations,
  readBaseline,
  writeBaseline,
} from "./lib/check-imports.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  "..",
);
const BASELINE = path.join(REPO_ROOT, "imports-baseline.json");

async function main() {
  const found = await findViolations({ baseDir: REPO_ROOT });
  const known = readBaseline(BASELINE);
  const diff = compareToBaseline(found, known);

  if (process.argv.includes("--prune")) {
    writeBaseline(
      BASELINE,
      known.filter((key) => !diff.stale.includes(key)),
    );
    diff.stale = [];
  }
  const report = describeDiff(diff);
  if (report === null) {
    process.stdout.write(
      `OK: ${found.length} known violation(s), none new, none stale\n`,
    );
    return;
  }
  process.stderr.write(`error: ${report}\n`);
  process.exit(1);
}

try {
  await main();
} catch (err) {
  process.stderr.write(
    `fatal: could not check imports: ${err.message ?? err}\n`,
  );
  process.exit(2);
}
