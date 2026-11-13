/**
 * Word budgets for tracked Markdown docs: every doc has a row in one registry,
 * and a doc over its row fails the gate. Every generation and judging run reads
 * the agent workspace templates, judges and prompts, and pays for their length,
 * so their size is kept in view here rather than left to drift.
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
const REGULAR_FILE_MODES = new Set(["100644", "100755"]);

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
 * The problems with `docs` (`{ path, words }` for each tracked regular Markdown
 * file) against `registry` (a Map from `parseRegistry`). Each problem is
 * `{ kind, path, words?, budget? }` with kind `over`, `no-row` or `stale-row`.
 */
export function checkWordBudgets(docs, registry) {
  const problems = [];
  const tracked = new Set(docs.map((doc) => doc.path));
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
    if (!tracked.has(docPath)) {
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
        return `STALE ROW ${problem.path}: in ${REGISTRY_PATH}, but no tracked Markdown file has that path`;
    }
  });
  return [
    ...lines,
    `${problems.length} problem${problems.length === 1 ? "" : "s"} with word budgets.`,
    "Trim the doc to fit, or fix the row. Raising a budget is the operator's decision, not an executor's (docs/testing.md).",
  ].join("\n");
}

/**
 * Every tracked Markdown file in the repo, as `{ path, words }`, sorted by path.
 * Symlinks and submodules are skipped: a symlink such as `CLAUDE.md` answers to
 * its target's row. Read from git, not from a directory walk, so a file git does
 * not track never counts.
 */
export function trackedMarkdownDocs(repoRoot) {
  return execFileSync("git", ["ls-files", "-s", "--", "*.md"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      return { mode: line.slice(0, tab).split(" ")[0], path: line.slice(tab + 1) };
    })
    .filter((entry) => REGULAR_FILE_MODES.has(entry.mode))
    .filter((entry) => fs.existsSync(path.join(repoRoot, entry.path)))
    .map((entry) => ({
      path: entry.path,
      words: countWords(fs.readFileSync(path.join(repoRoot, entry.path), "utf8")),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
