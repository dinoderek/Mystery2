// `baseline status` against a throwaway git repo built in a temp dir: which
// commits a baseline's run has not seen, under squash merges. No model is called.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { baselineStatus, READ_PATHSPEC } from "../../../evaluation/core/baseline-status.ts";
import { revisionSources } from "../../../evaluation/core/baseline-sources.ts";
import { baselineSourceGroups } from "../../../evaluation/runtime/lib/baseline-inputs.ts";
import type { BaselineScope } from "../../../evaluation/runtime/lib/baseline-inputs.ts";

const REPO_ROOT = process.cwd();
const REAL_BASELINE = "evaluation/runtime/cases/clue-graph/greenhouse/baselines/haiku.json";
const BASELINE = "evaluation/runtime/cases/story/baselines/model.json";
const BRIEF = "evaluation/judges/gm-fabrication.md";
const ENGINE = "packages/game-engine/src/ai-prompts.ts";

let repo = "";

function git(...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  }).trim();
}

/** Writes each file, commits, and returns the commit's id. */
function commit(subject: string, files: Record<string, string>): string {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), text);
  }
  git("add", "-A");
  git("commit", "-m", subject);
  return git("rev-parse", "HEAD");
}

/** A baseline file is a real graded summary with its run's commit set. */
function baselineAt(run: string | null): string {
  const summary = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, REAL_BASELINE), "utf8"));
  summary.run.commit = run;
  delete summary.run.inputs;
  return JSON.stringify(summary);
}

async function status(args: string[] = []): Promise<{ code: number; output: string }> {
  const lines: string[] = [];
  const out = (text: string) => lines.push(text);
  const code = await runEval(["baseline", "status", ...args], { root: repo, out, err: out, env: process.env }, COMMANDS);
  return { code, output: lines.join("\n") };
}

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "baseline-status-"));
  git("init", "-q", "-b", "main");
  commit("start", { [BRIEF]: "brief 1\n", [ENGINE]: "engine 1\n" });
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("baseline status", () => {
  it("reads a baseline saved on a side branch and squash-merged as current on the main line", async () => {
    git("checkout", "-q", "-b", "side");
    const run = commit("change the brief", { [BRIEF]: "brief 2\n" });
    commit("save the baseline", { [BASELINE]: baselineAt(run) });
    git("checkout", "-q", "main");
    git("merge", "--squash", "side");
    git("commit", "-m", "the branch, squashed");
    expect(() => git("merge-base", "--is-ancestor", run, "HEAD")).toThrow();

    expect(baselineStatus(repo, run)).toEqual({ kind: "current" });
    const result = await status();
    expect(result.code).toBe(0);
    expect(result.output).toContain(`${BASELINE}: current (run at ${run.slice(0, 7)})`);
    expect(result.output).toContain("1 current, 0 stale, 0 unknown");
  });

  it("does not list a commit touching only a baseline file, a README or a path no run reads", () => {
    const run = git("rev-list", "--max-parents=0", "HEAD");
    const squash = git("rev-parse", "HEAD");
    // The run was at the brief's first text, so the squash is the commit it has not seen.
    expect(baselineStatus(repo, run)).toMatchObject({ kind: "stale", commits: [{ subject: "the branch, squashed" }] });

    commit("only a baseline", { [BASELINE]: baselineAt(squash) });
    commit("only a doc", { "evaluation/runtime/README.md": "doc\n", "evaluation/judges/README.md": "doc\n" });
    commit("outside the read paths", { "web/page.txt": "x\n", "docs/game.md": "x\n" });
    expect(baselineStatus(repo, squash)).toEqual({ kind: "current" });
  });

  it("marks a baseline stale after a commit to a read path, listing it and nothing before the run", async () => {
    const run = git("rev-parse", "HEAD");
    commit("outside again", { "web/other.txt": "y\n" });
    const engine = commit("change the engine", { [ENGINE]: "engine 2\n" });
    commit("change the brief", { [BRIEF]: "brief 3\n" });

    const result = baselineStatus(repo, run);
    expect(result).toMatchObject({ kind: "stale" });
    if (result.kind !== "stale") return;
    expect(result.commits.map((c) => c.subject)).toEqual(["change the brief", "change the engine"]);
    expect(result.commits[1].short).toBe(engine.slice(0, 7));

    fs.writeFileSync(path.join(repo, BASELINE), baselineAt(run));
    const report = await status();
    expect(report.code).toBe(0);
    expect(report.output).toContain(`${BASELINE}: STALE (run at ${run.slice(0, 7)}), 2 commits touch what its runs read`);
    expect(report.output).toContain(`    ${engine.slice(0, 7)} change the engine`);
    expect(report.output).toContain("0 current, 1 stale, 0 unknown");
  });

  it("reports a commit it cannot resolve, or none recorded, and still exits 0", async () => {
    expect(baselineStatus(repo, "0".repeat(40))).toMatchObject({ kind: "unknown", reason: expect.stringContaining("not available") });
    expect(baselineStatus(repo, null)).toMatchObject({ kind: "unknown" });

    fs.writeFileSync(path.join(repo, BASELINE), baselineAt("0".repeat(40)));
    const report = await status();
    expect(report.code).toBe(0);
    expect(report.output).toContain(`${BASELINE}: unknown, commit 0000000 is not available here`);
    expect(report.output).toContain("0 current, 0 stale, 1 unknown");
  });

  it("lists the commits since the merge base for a run on unmerged work", async () => {
    git("checkout", "-q", "-b", "unmerged");
    const run = commit("never merged", { [BRIEF]: "brief unmerged\n" });
    git("checkout", "-q", "main");
    expect(baselineStatus(repo, run)).toEqual({ kind: "stale", commits: [] });
    fs.writeFileSync(path.join(repo, BASELINE), baselineAt(run));
    expect((await status()).output).toContain("differs from HEAD, but no commit on its history touches them");

    commit("after the branch", { [ENGINE]: "engine 3\n" });
    const result = baselineStatus(repo, run);
    expect(result).toMatchObject({ kind: "stale" });
    if (result.kind !== "stale") return;
    expect(result.commits.map((c) => c.subject)).toEqual(["after the branch"]);
  });

  it("fails loudly on a baseline it cannot read", async () => {
    fs.writeFileSync(path.join(repo, BASELINE), "{ not json");
    const report = await status();
    expect(report.code).toBe(1);
    expect(report.output).toContain("cannot read a graded summary");
  });

  it("reports prompt and blueprint drift with the source commit missing and separates PR changes", async () => {
    const prompt = "packages/game-engine/src/clue-graph/prompts.ts";
    const accusation = "packages/game-engine/src/clue-graph/judge-guidance.ts";
    const blueprint = "blueprints/clue-graph/test-story.json";
    const files = Object.fromEntries([prompt, accusation, ENGINE].map((file) => [file, fs.readFileSync(path.join(REPO_ROOT, file), "utf8")]));
    files[blueprint] = '{"time_budget":10}';
    const base = commit("inputs as run", files);
    const scope: BaselineScope = {
      case_paths: [], blueprints: [blueprint], judges: [], prompts: ["talk", "search"], external_inputs: false, server: false,
    };
    const unavailable = "0".repeat(40);
    const stored = JSON.parse(baselineAt(unavailable));
    stored.run.inputs = {
      version: 1, scope, sources: baselineSourceGroups(revisionSources(repo, base), scope), cases: [],
      settings: { narrator_models: [], judge_models: [], samples: null, concurrency: null, ai_profile: null },
    };
    commit("baseline metadata only", { [BASELINE]: JSON.stringify(stored) });
    const current = await status();
    expect(current.output).toContain("1 current, 0 stale, 0 unknown");

    const prior = commit("older blueprint change", { [blueprint]: '{"time_budget":20}' });
    commit("change only talk", { [prompt]: files[prompt].replace("has just turned", "has just walked up") });
    const report = await status(["--base", prior, "--details"]);
    expect(report.code).toBe(0);
    expect(report.output).toContain("0 current, 1 stale, 0 unknown");
    const [previous, proposal] = report.output.split("PR base → HEAD");
    expect(previous).toContain("Blueprints: test-story.json");
    expect(previous).not.toContain("Narrator prompts: talk");
    expect(proposal).toContain("Narrator prompts: talk");
    expect(proposal).toContain("change only talk");
    expect(proposal).not.toContain("Shared code:");
    expect(proposal).not.toContain("Narrator prompts: search");
  });

  it("checks relative case-module imports for a selective run", async () => {
    const caseFile = "evaluation/runtime/cases/story/selected.ts";
    const supportingCase = "evaluation/runtime/cases/story/other.ts";
    const base = commit("select a case that imports another", {
      [caseFile]: 'import { fact } from "./other.ts"; export default { fact };',
      [supportingCase]: 'export const fact = "first";',
    });
    const scope: BaselineScope = {
      case_paths: [caseFile], blueprints: [], judges: [], prompts: [], external_inputs: false, server: false,
    };
    const stored = JSON.parse(baselineAt("0".repeat(40)));
    stored.run.inputs = {
      version: 1, scope, sources: baselineSourceGroups(revisionSources(repo, base), scope), cases: [],
      settings: { narrator_models: [], judge_models: [], samples: null, concurrency: null, ai_profile: null },
    };
    commit("save selective baseline", { [BASELINE]: JSON.stringify(stored) });
    commit("change the imported fact", { [supportingCase]: 'export const fact = "second";' });
    const report = await status(["--details"]);
    expect(report.output).toContain("Cases: selected.ts");
    expect(report.output).toContain(`changed: ${supportingCase}`);
    expect(report.output).toContain("0 current, 1 stale, 0 unknown");
  });

  it("attributes judge wiring changes to the ref that introduces them", async () => {
    const registry = "evaluation/core/registry.ts";
    const oldBrief = "evaluation/judges/older-brief.md";
    const base = commit("judge on the recorded brief", { [registry]: "old judge wiring", [oldBrief]: "an older brief" });
    const scope: BaselineScope = {
      case_paths: [], blueprints: [], judges: ["gm_fabrication"], prompts: [], external_inputs: false, server: false,
    };
    const checkout = revisionSources(repo, base);
    const stored = JSON.parse(baselineAt("0".repeat(40)));
    const sources = baselineSourceGroups(checkout, scope, [
      { category: "Judges", name: "gm_fabrication", files: { [oldBrief]: checkout.digest(oldBrief) } },
    ]);
    stored.run.inputs = {
      version: 1, scope, sources, cases: [],
      settings: { narrator_models: [], judge_models: [], samples: null, concurrency: null, ai_profile: null },
    };
    commit("store recorded judge paths", { [BASELINE]: JSON.stringify(stored) });
    commit("redirect the judge", { [registry]: "new judge wiring" });
    const { output } = await status(["--base", base, "--details"]);
    const [previous, proposal] = output.split("PR base → HEAD");
    expect(previous).toContain("Recorded repository inputs match.");
    expect(proposal).toContain("Judges: shared selection and wiring");
    expect(proposal).toContain(`changed: ${registry}`);
  });

  it("includes the web adapter and AI seeding code for server runs", () => {
    const engine = "web/src/lib/server/engine.ts";
    const seed = "scripts/lib/ai-seed.mjs";
    const base = commit("server inputs", { [engine]: "web engine", [seed]: "AI seeding" });
    const scope: BaselineScope = {
      case_paths: [], blueprints: [], judges: [], prompts: [], external_inputs: false, server: true,
    };
    const before = baselineSourceGroups(revisionSources(repo, base), scope);
    const harness = before.find((group) => group.name === "evaluation harness and dependencies");
    expect(harness?.files).toEqual(expect.objectContaining({ [engine]: expect.any(String), [seed]: expect.any(String) }));
  });

  it("runs in this repo and exits 0, whatever the baselines read as", async () => {
    const lines: string[] = [];
    const out = (text: string) => lines.push(text);
    const code = await runEval(["baseline", "status"], { root: REPO_ROOT, out, err: out, env: process.env }, COMMANDS);
    expect(code).toBe(0);
    expect(lines.at(-1)).toMatch(/^\[baseline status\] \d+ current, \d+ stale, \d+ unknown$/);
  });
});

describe("what a run reads", () => {
  /** Files `judge turn` reaches only to start a throwaway server or to play, which no `narrator-*` baseline uses. */
  const SERVER_ONLY = [/^evaluation\/playtest\//, /^scripts\//, /^lib\//, /^web\//];

  function importClosure(entry: string): string[] {
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file) || !fs.existsSync(path.join(REPO_ROOT, file))) continue;
      seen.add(file);
      const text = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      for (const match of text.matchAll(/(?:from\s+|import\(\s*)["'](\.[^"']+)["']/g)) {
        queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])));
      }
    }
    return [...seen].sort();
  }

  it("lists every file `judge turn` imports, bar the server and playtest ones", () => {
    const read = new Set(execFileSync("git", ["ls-files", "--", ...READ_PATHSPEC], { cwd: REPO_ROOT, encoding: "utf8" }).split("\n"));
    const missed = importClosure("evaluation/runtime/judge-turn.ts").filter(
      (file) => !read.has(file) && !SERVER_ONLY.some((pattern) => pattern.test(file)),
    );
    expect(missed).toEqual([]);
  });

  it("lists the files it loads by path", () => {
    const read = new Set(execFileSync("git", ["ls-files", "--", ...READ_PATHSPEC], { cwd: REPO_ROOT, encoding: "utf8" }).split("\n"));
    for (const file of ["evaluation/lib/readability.ts", "evaluation/config.example.json", "evaluation/judges/gm-fabrication.md", "packages/game-engine/src/ai-prompts.ts"]) {
      expect(read.has(file), file).toBe(true);
    }
    expect(read.has("evaluation/runtime/README.md")).toBe(false);
    expect(read.has("evaluation/runtime/cases/clue-graph/greenhouse/baselines/haiku.json")).toBe(false);
  });
});
