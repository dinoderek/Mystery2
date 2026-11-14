import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

import { readFloors } from "../../../scripts/lib/coverage-floors.mjs";
import { GATE_STEPS } from "../../../scripts/lib/gate-steps.mjs";
import { SOURCE_ROOTS } from "../../../scripts/lib/source-roots.mjs";
import { countWords } from "../../../scripts/lib/word-budgets.mjs";

// The properties of the evaluation tree as a whole that no single command's
// tests can see: one bindings file, one entry point, the static checks and the
// coverage floor reaching evaluation code, and the size of its docs. The rules
// a file must keep are in eval-static-guards.test.ts; each command's main path
// on stub bindings is in that command's own test.

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

const trackedFiles = (): string[] =>
  spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).stdout.split("\0").filter(Boolean);

describe("evaluation configuration", () => {
  it("is one file: no cli.json or cli.example.json is tracked, and evaluation/config.json is ignored by git", () => {
    expect(trackedFiles().filter((file) => /(^|\/)cli(\.example)?\.json$/.test(file))).toEqual([]);
    const ignored = spawnSync("git", ["check-ignore", "-q", "evaluation/config.json"], { cwd: ROOT });
    expect(ignored.status).toBe(0);
    expect(fs.existsSync(path.join(ROOT, "evaluation/config.example.json"))).toBe(true);
  });
});

describe("the entry point", () => {
  it("is ./dev eval: no standalone generator or validator script, and no eval, generate or validate npm script", () => {
    for (const script of ["scripts/generate-blueprint.mjs", "scripts/validate-blueprint.mjs"]) {
      expect(fs.existsSync(path.join(ROOT, script)), script).toBe(false);
    }
    const scripts = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts);
    expect(scripts.filter((name) => /^(eval(:|$)|generate:blueprint$|validate:blueprint$)/.test(name))).toEqual([]);
  });

  it("lists the evaluation commands from ./dev eval --help and exits 0", () => {
    const ran = spawnSync(process.execPath, [path.join(ROOT, "dev"), "eval", "--help"], { cwd: ROOT, encoding: "utf8" });
    expect(ran.status).toBe(0);
    for (const command of ["generate", "validate", "judge blueprint", "judge game", "judge turn", "cases", "play", "report"]) {
      expect(ran.stdout).toContain(command);
    }
  });

  it("refuses the generator's old --chat-packet mode as an unknown option, exiting 1", () => {
    const ran = spawnSync(process.execPath, [path.join(ROOT, "dev"), "eval", "generate", "brief.json", "--chat-packet"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("--chat-packet");
  });
});

describe("the gate's static checks", () => {
  const sample = ["evaluation/core/runner.ts", "scripts/dev-cli.mjs", "lib/database-target.mjs"];

  it("run in the gate", () => {
    const names = GATE_STEPS.map((step: { name: string }) => step.name);
    expect(names).toEqual(expect.arrayContaining(["lint", "typecheck", "quality", "imports", "coverage-floors"]));
  });

  it("lint evaluation/, scripts/ and lib/", async () => {
    const eslint = new ESLint({ cwd: ROOT });
    for (const file of sample) {
      expect(fs.existsSync(path.join(ROOT, file)), file).toBe(true);
      expect(await eslint.isPathIgnored(path.join(ROOT, file)), file).toBe(false);
    }
  });

  it("type-check all of evaluation/", () => {
    const tsconfig = JSON.parse(fs.readFileSync(path.join(ROOT, "tsconfig.json"), "utf8"));
    expect(tsconfig.include).toContain("evaluation/**/*");
  });

  it("hold evaluation/, scripts/ and lib/ to the quality limits and the import rules", () => {
    expect(SOURCE_ROOTS).toEqual(expect.arrayContaining(["evaluation", "scripts", "lib"]));
  });
});

describe("evaluation coverage", () => {
  it("has a floor of at least 80% of lines and 75% of branches, over every evaluation TypeScript file", () => {
    const { evaluation } = readFloors(ROOT);
    expect(evaluation.lines).toBeGreaterThanOrEqual(80);
    expect(evaluation.branches).toBeGreaterThanOrEqual(75);
    expect(fs.readFileSync(path.join(ROOT, "vitest.config.ts"), "utf8")).toContain('"evaluation/**/*.ts"');
  });
});

describe("the evaluation docs", () => {
  const DOCS = [
    "docs/evaluation-pipeline.md",
    "evaluation/README.md",
    "evaluation/judges/README.md",
    "evaluation/trace/README.md",
    "evaluation/runtime/README.md",
    "evaluation/playtest/README.md",
  ];

  it("total at most 5,200 words, counted as wc -w counts them", () => {
    const total = DOCS.reduce((sum, doc) => sum + countWords(fs.readFileSync(path.join(ROOT, doc), "utf8")), 0);
    expect(total).toBeLessThanOrEqual(5200);
  });
});
