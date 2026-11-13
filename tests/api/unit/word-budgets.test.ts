import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BUDGET_STEP,
  checkWordBudgets,
  countWords,
  describeProblems,
  listMarkdownDocs,
  parseRegistry,
  suggestBudget,
} from "../../../scripts/lib/word-budgets.mjs";

/**
 * The word budget check is only worth having if its verdict is trustworthy: a
 * doc over its budget must be named with its count, a doc with no row must be
 * caught, and a row left behind must not quietly keep its room.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("countWords", () => {
  it("counts whitespace-separated words, as wc -w does", () => {
    expect(countWords("one two\n\tthree  four\n")).toBe(4);
    expect(countWords("")).toBe(0);
    expect(countWords("  \n ")).toBe(0);
  });
});

describe("suggestBudget", () => {
  it("rounds up to the next multiple of 50, and never below one step", () => {
    expect(suggestBudget(0)).toBe(BUDGET_STEP);
    expect(suggestBudget(511)).toBe(550);
    expect(suggestBudget(1047)).toBe(1050);
  });
});

describe("checkWordBudgets", () => {
  const registry = new Map([
    ["docs/a.md", 100],
    ["docs/b.md", 50],
  ]);

  it("passes when every doc is within its budget, including exactly at it", () => {
    const docs = [
      { path: "docs/a.md", words: 100 },
      { path: "docs/b.md", words: 12 },
    ];
    expect(checkWordBudgets(docs, registry)).toEqual([]);
  });

  it("fails naming a doc over its budget, with its count and budget", () => {
    const problems = checkWordBudgets(
      [
        { path: "docs/a.md", words: 101 },
        { path: "docs/b.md", words: 50 },
      ],
      registry,
    );
    expect(problems).toEqual([
      { kind: "over", path: "docs/a.md", words: 101, budget: 100 },
    ]);
    expect(describeProblems(problems)).toContain(
      "OVER docs/a.md: 101 words, budget 100",
    );
  });

  it("fails naming a doc with no row", () => {
    const problems = checkWordBudgets(
      [
        { path: "docs/a.md", words: 10 },
        { path: "docs/b.md", words: 10 },
        { path: "docs/new.md", words: 7 },
      ],
      registry,
    );
    expect(problems).toEqual([
      { kind: "no-row", path: "docs/new.md", words: 7 },
    ]);
    expect(describeProblems(problems)).toContain("NO ROW docs/new.md: 7 words");
  });

  it("fails on a row for a doc that is no longer tracked, so the registry cannot rot", () => {
    const problems = checkWordBudgets(
      [
        { path: "docs/a.md", words: 10 },
        { path: "docs/b.md", words: 10 },
      ],
      new Map([...registry, ["docs/gone.md", 50]]),
    );
    expect(problems).toEqual([{ kind: "stale-row", path: "docs/gone.md" }]);
  });

  it("says raising a budget is the operator's decision", () => {
    const text = describeProblems([{ kind: "over", path: "x.md", words: 60, budget: 50 }]);
    expect(text).toContain("operator's decision");
  });
});

describe("parseRegistry", () => {
  it("reads a header and one path-and-budget row per doc", () => {
    const rows = parseRegistry("path\tbudget\nAGENTS.md\t600\ndocs/a.md\t50\n");
    expect([...rows.entries()]).toEqual([
      ["AGENTS.md", 600],
      ["docs/a.md", 50],
    ]);
  });

  it("rejects a missing header", () => {
    expect(() => parseRegistry("AGENTS.md\t600\n")).toThrow(/first line/);
  });

  it("rejects a budget that is not a multiple of 50", () => {
    expect(() => parseRegistry("path\tbudget\nAGENTS.md\t575\n")).toThrow(
      /not a multiple of 50/,
    );
  });

  it("rejects a budget that is not a whole number", () => {
    expect(() => parseRegistry("path\tbudget\nAGENTS.md\tlots\n")).toThrow(
      /not a whole number/,
    );
  });

  it("rejects a row with no tab", () => {
    expect(() => parseRegistry("path\tbudget\nAGENTS.md 600\n")).toThrow(/expected/);
  });

  it("rejects a second row for the same path", () => {
    expect(() =>
      parseRegistry("path\tbudget\nAGENTS.md\t600\nAGENTS.md\t650\n"),
    ).toThrow(/second row/);
  });
});

describe("the committed registry", () => {
  it("parses, and every budget is a multiple of 50", () => {
    const text = fs.readFileSync(path.join(REPO_ROOT, "docs/word-budgets.tsv"), "utf8");
    const rows = parseRegistry(text);
    expect(rows.size).toBeGreaterThan(0);
    for (const [docPath, budget] of rows) {
      expect(budget % BUDGET_STEP, docPath).toBe(0);
    }
  });
});

describe("listMarkdownDocs", () => {
  let repo: string;

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" });

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "word-budgets-"));
    git("init", "-q");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "test");
    fs.mkdirSync(path.join(repo, "docs"));
    fs.writeFileSync(path.join(repo, "AGENTS.md"), "one two three\n");
    fs.writeFileSync(path.join(repo, "docs", "a.md"), "four five\n");
    fs.writeFileSync(path.join(repo, ".gitignore"), "ignored/\n");
    fs.mkdirSync(path.join(repo, "ignored"));
    fs.writeFileSync(path.join(repo, "ignored", "out.md"), "not counted\n");
    fs.writeFileSync(path.join(repo, "docs", "untracked.md"), "not yet added\n");
    fs.writeFileSync(path.join(repo, "notes.txt"), "not markdown\n");
    fs.symlinkSync("AGENTS.md", path.join(repo, "CLAUDE.md"));
    git("add", "AGENTS.md", "docs/a.md", "CLAUDE.md", "notes.txt");
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("lists regular Markdown files with their word counts, tracked or not yet added, skipping symlinks and ignored files", () => {
    expect(listMarkdownDocs(repo)).toEqual([
      { path: "AGENTS.md", words: 3 },
      { path: "docs/a.md", words: 2 },
      { path: "docs/untracked.md", words: 3 },
    ]);
  });

  it("gives a doc that is not yet added no row, so the check fails before CI does", () => {
    const registry = new Map([
      ["AGENTS.md", 50],
      ["docs/a.md", 50],
    ]);
    expect(checkWordBudgets(listMarkdownDocs(repo), registry)).toEqual([
      { kind: "no-row", path: "docs/untracked.md", words: 3 },
    ]);
  });

  it("skips a tracked file deleted from the working tree", () => {
    fs.rmSync(path.join(repo, "docs", "a.md"));
    fs.rmSync(path.join(repo, "docs", "untracked.md"));
    expect(listMarkdownDocs(repo)).toEqual([{ path: "AGENTS.md", words: 3 }]);
  });
});
