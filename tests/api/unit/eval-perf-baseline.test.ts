// `perf baseline`: a committed suite run on its own models, refused on a dirty
// tree, its records named for the suite and pushed to a local bare repository
// standing in for the data repository, never GitHub. Narrators and judges are
// stub wrappers; no test calls a model. Also: the committed suites parse, name
// inputs and bindings that exist, and the narration suite makes the runs the
// retained Haiku baselines were saved from.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { loadConfig } from "../../../evaluation/core/config.ts";
import { generateCommand } from "../../../evaluation/generate/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import type { EvalCommand } from "../../../evaluation/core/dispatch.ts";
import { createPerfBaselineCommand, readSuite, suiteNames, suiteRunArgv, SUITES_DIR } from "../../../evaluation/perf/baseline.ts";
import { runFolders } from "../../../evaluation/perf/push.ts";
import { readRecord } from "../../../evaluation/perf/record.ts";
import { readSummary } from "../../../evaluation/runtime/lib/expect-summary.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const CASE = "evaluation/runtime/cases/clue-graph/mock-case/readability.ts";
const CLEAN = () => ({ commit: "0123456789abcdef0123456789abcdef01234567", tree_clean: true });

let scratch = "";
let remote = "";
let outputRoot = "";
let configFile = "";
let suitesDir = "";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@localhost", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function makeRemote(): string {
  const bare = path.join(scratch, "data.git");
  git(scratch, "init", "--bare", "--quiet", "-b", "main", bare);
  const seed = path.join(scratch, "seed");
  git(scratch, "clone", "--quiet", bare, seed);
  fs.writeFileSync(path.join(seed, "README.md"), "data\n");
  git(seed, "add", "README.md");
  git(seed, "commit", "--quiet", "-m", "README");
  git(seed, "push", "--quiet", "origin", "HEAD:main");
  return bare;
}

function remoteFiles(): string[] {
  return git(remote, "ls-tree", "-r", "--name-only", "main").split("\n").filter(Boolean).sort();
}

/** A local config whose narrator is a stub wrapper on a model of its own, which the suite replaces. */
function writeConfig(perf: unknown = { remote }): void {
  const stub = (cmd: string) => ({ cmd, args: ["{{user_message_file}}"], timeout_ms: 30_000 });
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      developer: "ada",
      perf,
      "narrator-claude": { ...stub("evaluation/runtime/config/wrappers/stub-runtime.sh"), model: "local-model" },
      "judge-stub": stub("evaluation/runtime/config/wrappers/stub-judge.sh"),
    }),
  );
}

const RUN = { command: "judge turn", inputs: [CASE], options: { narrator: "narrator-claude", judges: "flesch" }, samples: null, concurrency: 2 };

function writeSuite(name: string, suite: unknown): void {
  fs.writeFileSync(path.join(suitesDir, `${name}.json`), JSON.stringify(suite));
}

async function baseline(args: string[], command: EvalCommand = createPerfBaselineCommand({ suitesDir, readCommit: CLEAN })) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runEval(["perf", "baseline", ...args, "--config", configFile, "--output-root", outputRoot], { root: ROOT, out: (t) => out.push(t), err: (t) => err.push(t), env: {} }, [command]);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

beforeEach(() => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "eval-perf-baseline-")));
  outputRoot = path.join(scratch, "runs");
  suitesDir = path.join(scratch, "suites");
  fs.mkdirSync(suitesDir);
  remote = makeRemote();
  configFile = path.join(scratch, "config.json");
  writeConfig();
});

afterEach(() => {
  delete process.env.RUNTIME_JUDGE_STUB_VERDICT;
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("perf baseline", () => {
  it("runs each of the suite's runs on its models, records the suite, and pushes every record", async () => {
    writeSuite("tiny", { models: { "narrator-claude": "suite-model" }, runs: [RUN, { ...RUN, concurrency: 1 }] });

    const result = await baseline(["tiny", "--label", "first"]);

    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    const folders = runFolders(outputRoot);
    expect(folders).toHaveLength(2);
    const records = folders.map((folder) => readRecord(folder));
    for (const record of records) {
      expect(record.run.suite).toBe("tiny");
      expect(record.run.label).toBe("first");
      expect(record.run.attributes?.suite).toBe("tiny");
      expect(record.run.bindings["narrator-claude"].model).toBe("suite-model");
      expect(record.run.attributes?.models.narrator).toEqual(["narrator-claude:suite-model"]);
      expect(record.calls.every((call) => call.model === "suite-model")).toBe(true);
    }
    expect(records.map((record) => record.run.attributes?.concurrency).sort()).toEqual([1, 2]);
    const pushed = remoteFiles().filter((file) => file.startsWith("records/"));
    expect(pushed).toHaveLength(2);
    expect(pushed.every((file) => file.includes("/ada/"))).toBe(true);
    expect(result.out).toContain("[perf push] 2 sent");
  });

  it("records no local path in a run's argv when the output root comes from the env", async () => {
    writeSuite("tiny", { models: { "narrator-claude": "suite-model" }, runs: [RUN] });
    const command = createPerfBaselineCommand({ suitesDir, readCommit: CLEAN });
    const err: string[] = [];
    const env = { MYSTERYEVALS_DIR: outputRoot };
    const code = await runEval(["perf", "baseline", "tiny", "--config", configFile], { root: ROOT, out: () => {}, err: (t) => err.push(t), env }, [command]);

    expect(err).toEqual([]);
    expect(code).toBe(0);
    const [folder] = runFolders(outputRoot);
    const { argv } = readRecord(folder).run;
    expect(argv).not.toContain("--output-root");
    expect(argv.filter((arg) => arg !== configFile && path.isAbsolute(arg))).toEqual([]);
    expect(argv.slice(0, 1)).toEqual([path.relative(process.cwd(), path.join(ROOT, CASE))]);
  });

  it("refuses a dirty tree before anything runs", async () => {
    writeSuite("tiny", { models: { "narrator-claude": "suite-model" }, runs: [RUN] });
    const dirty = createPerfBaselineCommand({ suitesDir, readCommit: () => ({ commit: "abc", tree_clean: false }) });

    const result = await baseline(["tiny"], dirty);

    expect(result.code).toBe(1);
    expect(result.err).toContain("uncommitted changes");
    expect(runFolders(outputRoot)).toEqual([]);
  });

  it("says a failed push once and keeps the run's exit code; perf push sends the record later", async () => {
    process.env.RUNTIME_JUDGE_STUB_VERDICT = JSON.stringify({ estimated_reading_age: 14, findings: [], verdict: "fail", reasoning: "Too hard." });
    writeSuite("tiny", {
      models: { "narrator-claude": "suite-model" },
      runs: [{ ...RUN, options: { narrator: "narrator-claude", judges: "age_appropriate_turn", "judge-binding": "judge-stub" } }],
    });
    writeConfig({ remote: path.join(scratch, "no-such-remote.git") });

    const result = await baseline(["tiny"]);

    expect(result.code).toBe(2);
    expect(result.err.match(/not pushed/g)).toHaveLength(1);
    expect(remoteFiles().filter((file) => file.startsWith("records/"))).toEqual([]);

    writeConfig();
    const out: string[] = [];
    const code = await runEval(["perf", "push", "--config", configFile, "--output-root", outputRoot], { root: ROOT, out: (t) => out.push(t), err: () => {}, env: {} }, COMMANDS);
    expect(code).toBe(0);
    expect(remoteFiles().filter((file) => file.startsWith("records/"))).toHaveLength(1);
  });

  it("says once that nothing was pushed when perf.remote is not set", async () => {
    writeSuite("tiny", { models: { "narrator-claude": "suite-model" }, runs: [RUN] });
    writeConfig(null);

    const result = await baseline(["tiny"]);

    expect(result.code).toBe(0);
    expect(result.err.match(/not pushed/g)).toHaveLength(1);
    expect(result.err).toContain("perf.remote is not set");
  });

  it("names a binding the suite left on the config's model", async () => {
    writeSuite("tiny", { models: {}, runs: [RUN] });

    const result = await baseline(["tiny"]);

    expect(result.code).toBe(0);
    expect(result.err).toContain("binding narrator-claude ran on the config's model local-model");
  });

  it("refuses --model-override and --suite, and an unknown suite names the suites there are", async () => {
    writeSuite("tiny", { models: {}, runs: [RUN] });

    expect((await baseline(["tiny", "--model-override", "narrator-claude=other"])).err).toContain("a suite names its models");
    expect((await baseline(["tiny", "--suite", "other"])).err).toContain("--suite is the suite's name");
    const unknown = await baseline(["nope"]);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain('no suite "nope"');
    expect(unknown.err).toContain("Suites: tiny");
    expect(runFolders(outputRoot)).toEqual([]);
  });

  it("refuses a suite that sets what it sets itself, or samples a command does not take", () => {
    writeSuite("bad", { models: {}, runs: [{ ...RUN, options: { "model-override": "x=y" } }] });
    expect(() => readSuite(suitesDir, "bad")).toThrow(/--model-override is not an option a suite sets/);
    writeSuite("bad", { models: {}, runs: [{ ...RUN, options: { concurrency: 3 } }] });
    expect(() => readSuite(suitesDir, "bad")).toThrow(/--concurrency is not an option a suite sets/);
    writeSuite("bad", { models: {}, runs: [{ ...RUN, command: "generate", samples: 2 }] });
    expect(() => readSuite(suitesDir, "bad")).toThrow(/generate takes no samples/);
  });
});

describe("the committed suites", () => {
  const dir = path.join(ROOT, SUITES_DIR);
  const example = loadConfig({ root: ROOT, configPath: path.join(ROOT, "evaluation/config.example.json") });

  it("are blueprint-loop and narration-loop", () => {
    expect(suiteNames(dir)).toEqual(["blueprint-loop", "narration-loop"]);
  });

  it.each(["blueprint-loop", "narration-loop"])("%s parses, and names inputs and bindings that exist", (name) => {
    const suite = readSuite(dir, name);
    for (const run of suite.runs) {
      for (const input of run.inputs) expect(fs.existsSync(path.join(ROOT, input)), input).toBe(true);
    }
    for (const binding of Object.keys(suite.models)) expect(Object.keys(example.bindings)).toContain(binding);
  });

  it("blueprint-loop generates, judges and repairs the three committed briefs", () => {
    const [run, ...rest] = readSuite(dir, "blueprint-loop").runs;
    expect(rest).toEqual([]);
    const briefs = fs.readdirSync(path.join(ROOT, "blueprints/clue-graph/briefs")).map((file) => `blueprints/clue-graph/briefs/${file}`).sort();
    expect([...run.inputs].sort()).toEqual(briefs);
    expect(run).toMatchObject({ command: "generate", options: { judge: true, repair: 2 } });
  });

  it.each(["blueprint-loop", "narration-loop"])("%s gives each run only flags its command takes", (name) => {
    const suite = readSuite(dir, name);
    const commands = new Map(COMMANDS.map((command) => [command.name, command.help]));
    commands.set("generate", generateCommand.help);
    for (const run of suite.runs) {
      const help = commands.get(run.command) ?? "";
      const flags = suiteRunArgv(run, { name, models: suite.models }, ROOT).filter((arg) => arg.startsWith("--"));
      for (const flag of new Set(flags)) expect(help, `${run.command} ${flag}`).toMatch(new RegExp(`^\\s+${flag}\\b`, "m"));
    }
  });

  it("narration-loop makes, per case folder, the run its retained Haiku baseline was saved from", () => {
    const suite = readSuite(dir, "narration-loop");
    expect(suite.models["narrator-claude"]).toBe("haiku");
    const folders = suite.runs.map((run) => run.inputs);
    expect(folders).toEqual([["evaluation/runtime/cases/clue-graph/greenhouse"], ["evaluation/runtime/cases/clue-graph/dragon-crown"]]);
    for (const run of suite.runs) {
      const argv = suiteRunArgv(run, { name: "narration-loop", models: suite.models }, ROOT);
      const retained = readSummary(path.join(ROOT, run.inputs[0], "baselines/haiku.json")).run.argv;
      // The retained run's options, each with its value, are the suite run's.
      for (let i = 1; i < retained.length; i += 2) {
        const at = argv.findIndex((arg, j) => arg === retained[i] && argv[j + 1] === retained[i + 1]);
        expect(at, `${retained[i]} ${retained[i + 1]}`).toBeGreaterThan(-1);
      }
      expect(path.resolve(argv[2])).toBe(path.join(ROOT, retained[0]));
    }
  });
});
