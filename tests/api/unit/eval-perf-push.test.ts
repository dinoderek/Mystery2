// `perf push`: run records into the shared data repository, against a local
// bare repository standing in for the remote, never GitHub. Covers the first
// clone and push, a second push sending nothing, named runs, stub-only runs,
// a lost race, a missing `perf.remote`, and a record already present.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig, configuredPerfRemote } from "../../../evaluation/core/config.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import type { RunInfo } from "../../../evaluation/core/result.ts";
import { COMMANDS } from "../../../evaluation/commands.ts";
import { dataCloneDir, measuresNothing, pathSafe, publishRecords, recordPath } from "../../../evaluation/perf/data-repo.ts";
import { RECORD_SCHEMA_VERSION, RunRecordSchema, writeRecord } from "../../../evaluation/perf/record.ts";
import type { CallRow, RunRecord } from "../../../evaluation/perf/record.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");

let scratch = "";
let remote = "";
let outputRoot = "";
let configFile = "";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@localhost", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A bare repository whose `main` holds a README, as the real data repository does; `seeded: false` leaves it empty. */
function makeRemote(name: string, seeded = true): string {
  const bare = path.join(scratch, `${name}.git`);
  git(scratch, "init", "--bare", "--quiet", "-b", "main", bare);
  if (seeded) {
    const seed = path.join(scratch, `${name}-seed`);
    git(scratch, "clone", "--quiet", bare, seed);
    fs.writeFileSync(path.join(seed, "README.md"), "data\n");
    git(seed, "add", "README.md");
    git(seed, "commit", "--quiet", "-m", "README");
    git(seed, "push", "--quiet", "origin", "HEAD:main");
  }
  return bare;
}

/** What the remote's `main` holds, as paths. */
function remoteFiles(bare: string): string[] {
  try {
    return git(bare, "ls-tree", "-r", "--name-only", "main").split("\n").filter(Boolean).sort();
  } catch {
    return [];
  }
}

const TOKENS = { input: 10, output: 5, cache_read: 0, cache_write: 0 };

function call(model: string | null, binding = "generator-agent"): CallRow {
  return { subject: 0, round: null, role: "generator", judge: null, judge_version: null, binding, model, duration_ms: 10, cost_usd: model ? 0.1 : null, tokens: model ? TOKENS : null, attempts: 1, outcome: "ok" };
}

function runInfo(id: string, developer: string): RunInfo {
  return {
    id,
    command: id.split("/")[1].slice(9),
    argv: [],
    started_at: `${id.slice(0, 10)}T${id.slice(11, 19).replaceAll("-", ":")}.000Z`,
    ended_at: null,
    commit: "abc",
    tree_clean: true,
    bindings: {},
    judge_versions: {},
    suite: null,
    label: null,
    developer,
    host: "lab",
    parent_run: null,
    prompt_versions: { narrator: "0123456789ab", generator: "ba9876543210" },
    attributes: null,
  };
}

function record(id: string, developer: string, calls: CallRow[]): RunRecord {
  return RunRecordSchema.parse({
    schema_version: RECORD_SCHEMA_VERSION,
    result_version: "mystery-eval-result/3",
    run: runInfo(id, developer),
    exit_code: 0,
    comparable: true,
    subjects: [{ kind: "blueprint", id: "case", passed: true, rounds: null, run_error_stage: null }],
    calls,
    verdicts: [],
  });
}

/** Writes a run folder under the output root holding `rec`'s record. */
function addRun(rec: RunRecord): string {
  const dir = path.join(outputRoot, rec.run.id);
  fs.mkdirSync(dir, { recursive: true });
  writeRecord(dir, rec);
  return dir;
}

const REAL = [call("opus")];
const RUN_A = "2026-11-25/10-00-00-generate";
const RUN_B = "2026-12-01/09-30-00-judge-turn";
const PATH_A = "records/2026/11/ada/2026-11-25_10-00-00-generate.json";
const PATH_B = "records/2026/12/ada/2026-12-01_09-30-00-judge-turn.json";

async function push(...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runEval(["perf", "push", "--config", configFile, "--output-root", outputRoot, ...args], { root: ROOT, out: (t) => out.push(t), err: (t) => err.push(t), env: {} }, COMMANDS);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

function writeConfig(perf: unknown): void {
  fs.writeFileSync(configFile, JSON.stringify({ developer: "ada", ...(perf === undefined ? {} : { perf }) }));
}

beforeEach(() => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "eval-perf-push-")));
  outputRoot = path.join(scratch, "runs");
  fs.mkdirSync(outputRoot);
  remote = makeRemote("data");
  configFile = path.join(scratch, "config.json");
  writeConfig({ remote });
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("perf push", () => {
  it("clones on first use, sends every record at its path, and pushes", async () => {
    addRun(record(RUN_A, "ada", REAL));
    addRun(record(RUN_B, "ada", REAL));

    const result = await push();

    expect(result.code).toBe(0);
    expect(result.out).toContain("2 sent, 0 already in the data repository");
    expect(remoteFiles(remote)).toEqual(["README.md", PATH_A, PATH_B]);
    expect(fs.existsSync(path.join(dataCloneDir(outputRoot), ".git"))).toBe(true);
    expect(git(remote, "show", `main:${PATH_A}`)).toBe(fs.readFileSync(path.join(outputRoot, RUN_A, "record.json"), "utf8"));
    expect(git(remote, "log", "-1", "--format=%s", "main").trim()).toBe("Add 2 run records");
  });

  it("sends nothing the second time", async () => {
    addRun(record(RUN_A, "ada", REAL));
    await push();
    const tip = git(remote, "rev-parse", "main");

    const again = await push();

    expect(again.code).toBe(0);
    expect(again.out).toContain("0 sent, 1 already in the data repository");
    expect(git(remote, "rev-parse", "main")).toBe(tip);
  });

  it("sends only the run it is named, by folder or by id, and later sends the rest", async () => {
    const dirA = addRun(record(RUN_A, "ada", REAL));
    addRun(record(RUN_B, "ada", REAL));

    await push(RUN_B);
    expect(remoteFiles(remote)).toEqual(["README.md", PATH_B]);

    await push(dirA);
    expect(remoteFiles(remote)).toEqual(["README.md", PATH_A, PATH_B]);
  });

  it("never sends a run whose model calls all went to stubs, or made none", async () => {
    addRun(record(RUN_A, "ada", [call(null, "narrator-stub"), call("mock/runtime-default", "server")]));
    addRun(record(RUN_B, "ada", []));

    const result = await push();

    expect(result.code).toBe(0);
    expect(result.out).toContain(`skipped ${RUN_A}: every model call went to a stub`);
    expect(result.out).toContain(`skipped ${RUN_B}: it made no model call`);
    expect(result.out).toContain("nothing to send");
    expect(remoteFiles(remote)).toEqual(["README.md"]);
  });

  it("sends a run that mixes a stub call with a real one", async () => {
    addRun(record(RUN_A, "ada", [call(null, "narrator-stub"), call("haiku")]));
    await push();
    expect(remoteFiles(remote)).toEqual(["README.md", PATH_A]);
  });

  it("leaves a run folder without a record local, and refuses to send a named one", async () => {
    fs.mkdirSync(path.join(outputRoot, "2026-01-02", "03-04-05-play"), { recursive: true });
    addRun(record(RUN_A, "ada", REAL));

    const all = await push();
    expect(all.out).toContain("1 run folder(s) have no record.json and stay local");
    expect(remoteFiles(remote)).toEqual(["README.md", PATH_A]);

    const named = await push("2026-01-02/03-04-05-play");
    expect(named.code).toBe(1);
    expect(named.err).toContain("has no record.json");
  });

  it("reports a record it cannot read, still sends the rest, and exits 1", async () => {
    addRun(record(RUN_A, "ada", REAL));
    const bad = path.join(outputRoot, RUN_B);
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(path.join(bad, "record.json"), "{}");

    const result = await push();

    expect(result.code).toBe(1);
    expect(result.err).toContain(`not sent, unreadable record: ${RUN_B}`);
    expect(remoteFiles(remote)).toEqual(["README.md", PATH_A]);
  });

  it("is a usage error naming perf.remote when none is configured", async () => {
    addRun(record(RUN_A, "ada", REAL));
    for (const perf of [undefined, null, {}, { remote: null }]) {
      writeConfig(perf);
      const result = await push();
      expect(result.code).toBe(1);
      expect(result.err).toContain("perf.remote is not set");
    }
    expect(fs.existsSync(dataCloneDir(outputRoot))).toBe(false);
  });

  it("works against a remote that has no commits yet", async () => {
    const empty = makeRemote("empty", false);
    writeConfig({ remote: empty });
    addRun(record(RUN_A, "ada", REAL));

    const result = await push();

    expect(result.code).toBe(0);
    expect(remoteFiles(empty)).toEqual([PATH_A]);
  });

  it("files a run under its developer, with the run id's separators mapped", async () => {
    addRun(record(RUN_A, "Ada L./x", REAL));
    await push();
    expect(remoteFiles(remote)).toEqual(["README.md", "records/2026/11/Ada_L._x/2026-11-25_10-00-00-generate.json"]);
  });
});

describe("publishing records", () => {
  function files(...rest: Array<[string, string]>) {
    return rest.map(([p, content]) => ({ path: p, content }));
  }

  /** Another developer's clone pushing a record of their own. */
  function rival(file: string): void {
    const other = path.join(scratch, `rival-${Math.random().toString(36).slice(2)}`);
    git(scratch, "clone", "--quiet", remote, other);
    fs.mkdirSync(path.dirname(path.join(other, file)), { recursive: true });
    fs.writeFileSync(path.join(other, file), "{}\n");
    git(other, "add", file);
    git(other, "commit", "--quiet", "-m", "rival");
    git(other, "push", "--quiet", "origin", "HEAD:main");
  }

  it("rebases on a lost race and sends again", () => {
    const clone = dataCloneDir(outputRoot);
    const outcome = publishRecords({
      clone,
      remote,
      files: files([PATH_A, "{\"a\":1}\n"]),
      author: "ada",
      beforePush: (attempt) => {
        if (attempt === 1) rival("records/2026/11/bob/other.json");
      },
    });

    expect(outcome.sent).toEqual([PATH_A]);
    expect(remoteFiles(remote)).toEqual(["README.md", PATH_A, "records/2026/11/bob/other.json"]);
    expect(git(remote, "log", "--format=%s", "main").trim().split("\n")).toEqual(["Add 1 run record", "rival", "README"]);
  });

  it("gives up after its attempts, naming the remote, and a later push still works", () => {
    const clone = dataCloneDir(outputRoot);
    let rivals = 0;
    expect(() =>
      publishRecords({
        clone,
        remote,
        files: files([PATH_A, "{}\n"]),
        author: "ada",
        attempts: 3,
        beforePush: () => rival(`records/2026/11/bob/r${(rivals += 1)}.json`),
      }),
    ).toThrow(/could not push to .*3 attempts in a row.*run perf push again/);
    expect(remoteFiles(remote)).not.toContain(PATH_A);

    const outcome = publishRecords({ clone, remote, files: files([PATH_A, "{}\n"]), author: "ada" });
    expect(outcome.sent).toEqual([PATH_A]);
  });

  /** Makes the remote refuse every push, saying `denied by test`; returns a function that lifts the refusal. */
  function refusePushes(bare: string): () => void {
    const hook = path.join(bare, "hooks", "pre-receive");
    fs.writeFileSync(hook, "#!/bin/sh\necho 'denied by test' >&2\nexit 1\n", { mode: 0o755 });
    return () => fs.rmSync(hook);
  }

  it("does not retry a push the remote refuses, and says what git said", () => {
    refusePushes(remote);
    let attempts = 0;
    expect(() =>
      publishRecords({ clone: dataCloneDir(outputRoot), remote, files: files([PATH_A, "{}\n"]), author: "ada", beforePush: () => (attempts += 1) }),
    ).toThrow(/denied by test/);
    expect(attempts).toBe(1);
  });

  it("sends a record on a remote with no commits after an earlier push of it failed", () => {
    const empty = makeRemote("empty", false);
    const lift = refusePushes(empty);
    const clone = dataCloneDir(outputRoot);
    expect(() => publishRecords({ clone, remote: empty, files: files([PATH_A, "{}\n"]), author: "ada" })).toThrow(/denied by test/);
    expect(remoteFiles(empty)).toEqual([]);

    lift();
    const outcome = publishRecords({ clone, remote: empty, files: files([PATH_A, "{}\n"]), author: "ada" });

    expect(outcome).toEqual({ sent: [PATH_A], present: [] });
    expect(remoteFiles(empty)).toEqual([PATH_A]);
  });

  it("does not retry a failure that is not a lost race", () => {
    expect(() =>
      publishRecords({ clone: dataCloneDir(outputRoot), remote: path.join(scratch, "missing.git"), files: files([PATH_A, "{}\n"]), author: "ada" }),
    ).toThrow(/git clone .*failed/);
  });

  it("does not rewrite a record the repository already holds", () => {
    const clone = dataCloneDir(outputRoot);
    publishRecords({ clone, remote, files: files([PATH_A, "{\"first\":true}\n"]), author: "ada" });
    const tip = git(remote, "rev-parse", "main");

    const outcome = publishRecords({ clone, remote, files: files([PATH_A, "{\"first\":false}\n"], [PATH_B, "{}\n"]), author: "ada" });

    expect(outcome).toEqual({ sent: [PATH_B], present: [PATH_A] });
    expect(git(remote, "show", `main:${PATH_A}`)).toBe("{\"first\":true}\n");
    expect(git(remote, "rev-parse", "main")).not.toBe(tip);
  });

  it("sees a record another clone sent after this one last fetched", () => {
    const clone = dataCloneDir(outputRoot);
    publishRecords({ clone, remote, files: files([PATH_B, "{}\n"]), author: "ada" });
    rival(PATH_A);

    const outcome = publishRecords({ clone, remote, files: files([PATH_A, "{\"mine\":true}\n"]), author: "ada" });

    expect(outcome).toEqual({ sent: [], present: [PATH_A] });
    expect(git(remote, "show", `main:${PATH_A}`)).toBe("{}\n");
  });

  it("follows a changed remote setting", () => {
    const clone = dataCloneDir(outputRoot);
    publishRecords({ clone, remote, files: files([PATH_A, "{}\n"]), author: "ada" });
    const moved = makeRemote("moved");

    publishRecords({ clone, remote: moved, files: files([PATH_B, "{}\n"]), author: "ada" });

    expect(remoteFiles(moved)).toEqual(["README.md", PATH_B]);
  });
});

describe("where a record goes", () => {
  it("maps every character outside a path segment's safe set by one rule", () => {
    expect(pathSafe("2026-11-25/10-00-00-generate")).toBe("2026-11-25_10-00-00-generate");
    expect(pathSafe("Ada Lovelace")).toBe("Ada_Lovelace");
    expect(pathSafe("..")).toBe("_.");
    expect(pathSafe("a\\b:c")).toBe("a_b_c");
    expect(pathSafe("")).toBe("_");
  });

  it("is by the month the run started, in UTC", () => {
    expect(recordPath(record("2026-11-30/23-59-59-generate", "ada", REAL))).toBe("records/2026/11/ada/2026-11-30_23-59-59-generate.json");
  });

  it("calls a run stub-only when every call has no model or the mock one, and a call-less run too", () => {
    expect(measuresNothing({ calls: [call(null), call("mock/runtime-default")] })).toBe(true);
    expect(measuresNothing({ calls: [] })).toBe(true);
    expect(measuresNothing({ calls: [call(null), call("haiku")] })).toBe(false);
  });
});

describe("the perf.remote setting", () => {
  it("is read from the top-level perf key and is not a binding", () => {
    writeConfig({ remote: "  git@example.test:data.git " });
    expect(configuredPerfRemote({ root: ROOT, configPath: configFile })).toBe("git@example.test:data.git");
    expect(loadConfig({ root: ROOT, configPath: configFile }).bindings).toEqual({});
  });

  it("is null when absent, and a config error when it is not a string", () => {
    writeConfig(undefined);
    expect(configuredPerfRemote({ root: ROOT, configPath: configFile })).toBeNull();
    writeConfig({ remote: 3 });
    expect(() => configuredPerfRemote({ root: ROOT, configPath: configFile })).toThrow(/perf\.remote/);
    writeConfig({ remote: " " });
    expect(() => configuredPerfRemote({ root: ROOT, configPath: configFile })).toThrow(/perf\.remote/);
    writeConfig([]);
    expect(() => configuredPerfRemote({ root: ROOT, configPath: configFile })).toThrow(/"perf" must be an object/);
  });

  it("resolves a path from the repo root, and leaves a URL as it is", () => {
    writeConfig({ remote: "data.git" });
    expect(configuredPerfRemote({ root: scratch, configPath: configFile })).toBe(path.join(scratch, "data.git"));
    expect(configuredPerfRemote({ root: ROOT, configPath: configFile })).toBe("data.git");
    writeConfig({ remote: "git@example.test:data.git" });
    expect(configuredPerfRemote({ root: scratch, configPath: configFile })).toBe("git@example.test:data.git");
  });

  it("is null in the committed example", () => {
    expect(configuredPerfRemote({ root: ROOT, configPath: path.join(ROOT, "evaluation", "config.example.json") })).toBeNull();
  });
});
