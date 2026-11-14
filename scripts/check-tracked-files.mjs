#!/usr/bin/env node
/**
 * Fails, naming each one, on a tracked file named `ai.json`. Part of phase 1 of
 * the gate (`npm run check:tracked-files`).
 */

import path from "node:path";
import process from "node:process";
import url from "node:url";

import { describeForbidden, findForbiddenFiles, listTrackedFiles } from "./lib/tracked-files.mjs";

const REPO_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

try {
  const files = listTrackedFiles(REPO_ROOT);
  const report = describeForbidden(findForbiddenFiles(files));
  if (report === null) {
    process.stdout.write(`OK: no tracked ai.json among ${files.length} tracked file(s)\n`);
  } else {
    process.stderr.write(`error: ${report}\n`);
    process.exit(1);
  }
} catch (err) {
  process.stderr.write(`fatal: could not list tracked files: ${err.message ?? err}\n`);
  process.exit(2);
}
