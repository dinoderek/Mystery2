/**
 * Word budgets for the repo's Markdown docs: every doc has a row in one
 * registry, and a doc over its row fails the gate. Every generation and judging
 * run reads the agent workspace templates, judges and prompts, and pays for
 * their length, so their size is kept in view here rather than left to drift.
 *
 * The registry is `docs/word-budgets.tsv`: a header line, then one
 * `path<TAB>budget` row per doc. Budgets are multiples of BUDGET_STEP.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const REGISTRY_PATH = "docs/word-budgets.tsv";
export const BUDGET_STEP = 50;
const HEADER = "path\tbudget";

/**
 * Whitespace-separated words, as `wc -w` counts them. Anyone can reproduce a
 * number with that command.
 */
export function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** The budget a doc of `words` words would get: up to the next BUDGET_STEP. */
export function suggestBudget(words) {
  return Math.max(BUDGET_STEP, Math.ceil(words / BUDGET_STEP) * BUDGET_STEP);
}

/**
 * The registry as a Map of path to budget. Throws on a malformed file, a
 * duplicate path, or a budget that is not a multiple of BUDGET_STEP, so a bad
 * row fails loudly instead of quietly granting or denying room.
 */
export function parseRegistry(text) {
  const lines = text.split("\n").filter((line) => line !== "");
  if (lines.length === 0 || lines[0] !== HEADER) {
    throw new Error(`${REGISTRY_PATH}: the first line must be "path<TAB>budget"`);
  }
  const rows = new Map();
  lines.slice(1).forEach((line, index) => {
    const where = `${REGISTRY_PATH}:${index + 2}`;
    const cols = line.split("\t");
    if (cols.length !== 2) {
      throw new Error(`${where}: expected "path<TAB>budget", got ${JSON.stringify(line)}`);
    }
    const [docPath, raw] = cols;
    if (!/^\d+$/.test(raw)) {
      throw new Error(`${where}: budget ${JSON.stringify(raw)} is not a whole number`);
    }
    const budget = Number(raw);
    if (budget % BUDGET_STEP !== 0) {
      throw new Error(`${where}: budget ${budget} for ${docPath} is not a multiple of ${BUDGET_STEP}`);
    }
    if (rows.has(docPath)) {
      throw new Error(`${where}: ${docPath} has a second row`);
    }
    rows.set(docPath, budget);
  });
  return rows;
}

/**
 * The problems with `docs` (`{ path, words }` for each regular Markdown file,
 * from `listMarkdownDocs`) against `registry` (a Map from `parseRegistry`).
 * Each problem is `{ kind, path, words?, budget? }` with kind `over`, `no-row`
 * or `stale-row`.
 */
export function checkWordBudgets(docs, registry) {
  const problems = [];
  const present = new Set(docs.map((doc) => doc.path));
  for (const doc of docs) {
    if (!registry.has(doc.path)) {
      problems.push({ kind: "no-row", path: doc.path, words: doc.words });
    } else if (doc.words > registry.get(doc.path)) {
      problems.push({
        kind: "over",
        path: doc.path,
        words: doc.words,
        budget: registry.get(doc.path),
      });
    }
  }
  for (const docPath of registry.keys()) {
    if (!present.has(docPath)) {
      problems.push({ kind: "stale-row", path: docPath });
    }
  }
  return problems;
}

/** The gate log's text for a non-empty list of problems. */
export function describeProblems(problems) {
  const lines = problems.map((problem) => {
    switch (problem.kind) {
      case "over":
        return `OVER ${problem.path}: ${problem.words} words, budget ${problem.budget}`;
      case "no-row":
        return `NO ROW ${problem.path}: ${problem.words} words, and no row in ${REGISTRY_PATH}`;
      default:
        return `STALE ROW ${problem.path}: in ${REGISTRY_PATH}, but no Markdown file exists at that path`;
    }
  });
  return [
    ...lines,
    `${problems.length} problem${problems.length === 1 ? "" : "s"} with word budgets.`,
    "Trim the doc to fit, or fix the row. Raising a budget is the operator's decision, not an executor's (docs/testing.md).",
  ].join("\n");
}

/**
 * Every Markdown file in the repo, as `{ path, words }`, sorted by path: tracked,
 * plus untracked files git does not ignore (so a doc that is not yet added
 * fails here, not first in CI), minus tracked files deleted from the working
 * tree. Symlinks and submodules are skipped: a symlink such as `CLAUDE.md`
 * answers to its target's row. Read from git, not from a directory walk, so an
 * ignored file never counts.
 */
export function listMarkdownDocs(repoRoot) {
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\n")
    .filter(Boolean);
  return [...new Set(paths)]
    .filter((docPath) => isRegularFile(path.join(repoRoot, docPath)))
    .map((docPath) => ({
      path: docPath,
      words: countWords(fs.readFileSync(path.join(repoRoot, docPath), "utf8")),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** False for a missing path, a symlink, or a directory (a submodule). */
function isRegularFile(filePath) {
  try {
    return fs.lstatSync(filePath).isFile();
  } catch {
    return false;
  }
}
