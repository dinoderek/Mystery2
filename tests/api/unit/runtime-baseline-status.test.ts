// `baseline status` against a throwaway git repo built in a temp dir: which
// commits a baseline's run has not seen, under squash merges. No model is called.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { baselineStatus } from "../../../evaluation/core/baseline-status.ts";

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
  return JSON.stringify(summary);
}

async function status(): Promise<{ code: number; output: string }> {
  const lines: string[] = [];
  const out = (text: string) => lines.push(text);
  const code = await runEval(["baseline", "status"], { root: repo, out, err: out, env: process.env }, COMMANDS);
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

  it("runs in this repo and exits 0, whatever the baselines read as", async () => {
    const lines: string[] = [];
    const out = (text: string) => lines.push(text);
    const code = await runEval(["baseline", "status"], { root: REPO_ROOT, out, err: out, env: process.env }, COMMANDS);
    expect(code).toBe(0);
    expect(lines.at(-1)).toMatch(/^\[baseline status\] \d+ current, \d+ stale, \d+ unknown$/);
  });
});
