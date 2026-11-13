#!/usr/bin/env node
/**
 * Fails when a tracked Markdown doc is over its word budget, or has no row in
 * `docs/word-budgets.tsv`, or a row names a doc that is no longer tracked.
 * Part of phase 1 of the gate (`npm run check:word-budgets`).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import url from "node:url";

import {
  REGISTRY_PATH,
  checkWordBudgets,
  describeProblems,
  parseRegistry,
  trackedMarkdownDocs,
} from "./lib/word-budgets.mjs";

const REPO_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

function main() {
  const registry = parseRegistry(fs.readFileSync(path.join(REPO_ROOT, REGISTRY_PATH), "utf8"));
  const docs = trackedMarkdownDocs(REPO_ROOT);
  const problems = checkWordBudgets(docs, registry);

  if (problems.length === 0) {
    process.stdout.write(`OK: ${docs.length} Markdown file(s) within their word budgets\n`);
    return;
  }
  process.stderr.write(`${describeProblems(problems)}\n`);
  process.exit(1);
}

try {
  main();
} catch (err) {
  process.stderr.write(`fatal: ${err.message ?? err}\n`);
  process.exit(2);
}
