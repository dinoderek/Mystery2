#!/usr/bin/env node
// Drift checker for curated docs in evaluation/generator-harness/template/docs/.
//
// Each curated doc carries a header block of the form:
//
//   > Source: <repo-relative-path>
//   > Source git blob hash: `<sha>`
//   > Source git blob hashes:
//   > - `<repo-relative-path>` — `<sha>`
//   > - `<repo-relative-path>` — `<sha>`
//
// This script extracts every (source-path, sha) pair, recomputes
// `git hash-object` for the source, and reports drift.
//
// Exit codes:
//   0 — all curated docs match their sources
//   1 — drift detected (details printed)
//   2 — internal/setup error
//
// Run from the repo root: node evaluation/generator-harness/scripts/check-curated-docs.mjs

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import url from "node:url";

const SCRIPT_PATH = url.fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..", "..", "..");
const DOCS_DIR = path.join(REPO_ROOT, "evaluation", "generator-harness", "template", "docs");

// Match three forms:
//   Source git blob hash: `<sha>`        (singular, paired with a preceding "Source: <path>" line)
//   - `<path>` — `<sha>`                 (list item under "Source git blob hashes:")
//   Source: `<path>`                     (singular source path line)
const LIST_ITEM_RE = /^>\s*-\s*`([^`]+)`\s*[—-]\s*`([0-9a-f]{40})`\s*$/m;
const SINGLE_HASH_RE = /^>\s*Source git blob hash:\s*`([0-9a-f]{40})`\s*$/m;
const SINGLE_SOURCE_RE = /^>\s*Source:\s*`([^`]+)`\s*$/m;

function extractPairs(content) {
  const pairs = [];
  const lines = content.split("\n");
  // Pass 1: multi-line list items under "Source git blob hashes:"
  for (const line of lines) {
    const m = line.match(LIST_ITEM_RE);
    if (m) pairs.push({ source: m[1], expected: m[2] });
  }
  // Pass 2: single-source form (Source: + Source git blob hash:)
  if (pairs.length === 0) {
    const srcMatch = content.match(SINGLE_SOURCE_RE);
    const hashMatch = content.match(SINGLE_HASH_RE);
    if (srcMatch && hashMatch) {
      pairs.push({ source: srcMatch[1], expected: hashMatch[1] });
    }
  }
  return pairs;
}

function gitHashObject(absPath) {
  return execFileSync("git", ["hash-object", absPath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

async function main() {
  let docs;
  try {
    const entries = await fs.readdir(DOCS_DIR);
    docs = entries.filter((f) => f.endsWith(".md"));
  } catch (err) {
    process.stderr.write(`could not read ${DOCS_DIR}: ${err.message}\n`);
    process.exit(2);
  }

  let driftCount = 0;
  let checkedCount = 0;
  let missingHeaderCount = 0;

  for (const doc of docs) {
    const absDoc = path.join(DOCS_DIR, doc);
    const content = await fs.readFile(absDoc, "utf8");
    const pairs = extractPairs(content);

    if (pairs.length === 0) {
      process.stderr.write(
        `WARN ${doc}: no source/hash pairs found in header block\n`,
      );
      missingHeaderCount += 1;
      continue;
    }

    for (const { source, expected } of pairs) {
      checkedCount += 1;
      const absSource = path.join(REPO_ROOT, source);
      let actual;
      try {
        actual = gitHashObject(absSource);
      } catch (err) {
        process.stderr.write(
          `FAIL ${doc} -> ${source}: git hash-object failed (${err.message.split("\n")[0]})\n`,
        );
        driftCount += 1;
        continue;
      }
      if (actual !== expected) {
        process.stderr.write(
          `DRIFT ${doc} -> ${source}\n` +
            `  expected: ${expected}\n` +
            `  actual:   ${actual}\n`,
        );
        driftCount += 1;
      }
    }
  }

  if (driftCount === 0 && missingHeaderCount === 0) {
    process.stdout.write(
      `OK: ${docs.length} curated doc(s), ${checkedCount} source link(s) verified\n`,
    );
    process.exit(0);
  }
  if (driftCount > 0) {
    process.stderr.write(
      `\nDRIFT detected in ${driftCount} source link(s). Regenerate affected curated docs and update their header hashes.\n`,
    );
  }
  process.exit(driftCount > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err.message ?? err}\n`);
  process.exit(2);
});
