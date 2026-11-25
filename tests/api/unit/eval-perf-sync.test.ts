// `perf sync`: the local index, `perf.db`, rebuilt from run folders and the
// records fetched from the data repository (a local bare repository, never
// GitHub). Covers the rows for result versions 1 to 3, a rebuild giving the
// same rows, a run held in both places, an unreachable remote, and folders
// that are skipped or reported.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { RESULT_SCHEMA_VERSION, summarize } from "../../../evaluation/core/result.ts";
import type { ModelCall, Result, RunInfo, Verdict } from "../../../evaluation/core/result.ts";
import { recordFromFolder } from "../../../evaluation/core/run-folder.ts";
import { dataCloneDir, publishRecords, recordPath } from "../../../evaluation/perf/data-repo.ts";
import { buildIndex, INDEX_FILE, loopOf } from "../../../evaluation/perf/index-db.ts";
import { writeRecord } from "../../../evaluation/perf/record.ts";
import type { RunRecord } from "../../../evaluation/perf/record.ts";
import { openDatabase } from "../../../packages/game-engine/src/db/client.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const TOKENS = { input: 100, output: 20, cache_read: 3000, cache_write: 40 };

let scratch = "";
let outputRoot = "";
let configFile = "";
let remote = "";

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

function modelCall(binding: string, model: string): ModelCall {
  return {
    binding,
    model,
    prompt_sha256: "c".repeat(64),
    duration_ms: 1500,
    cost_usd: 0.25,
    tokens: TOKENS,
    attempts: [{ attempt: 1, outcome: "ok", duration_ms: 1500, cost_usd: 0.25, tokens: TOKENS }],
  };
}

function judged(id: string, status: Verdict["status"]): Verdict {
  return { id, tier: "judge", status, findings: ["MARKER one", "MARKER two"], call: modelCall("blueprint-judge", "opus") };
}

function runInfo(id: string, developer: string, extra: Partial<RunInfo> = {}): RunInfo {
  const [day, rest] = id.split("/");
  return {
    id,
    command: "generate",
    argv: [],
    started_at: `${day}T${rest.slice(0, 8).replaceAll("-", ":")}.000Z`,
    ended_at: null,
    commit: "abc",
    tree_clean: true,
    bindings: {},
    judge_versions: { cg_soundness: 1 },
    suite: "blueprint-loop",
    label: "try",
    developer,
    host: "lab",
    parent_run: null,
    prompt_versions: { narrator: "000000000001", generator: "aaaaaaaaaaa1" },
    attributes: null,
    ...extra,
  };
}

function blueprintResult(run: RunInfo): Result {
  const verdicts = [judged("cg_soundness", "pass")];
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    run,
    subject: { kind: "blueprint", id: "lighthouse", path: null },
    production: { calls: [modelCall("generator-agent", "opus")] },
    verdicts,
    summary: summarize(verdicts, null),
    run_error: null,
    timing: null,
  };
}

/** A result as an earlier version wrote it: no tokens, and for 1 and 2 none of the later run fields. */
function asVersion(value: Result, version: 1 | 2): unknown {
  const strip = (each: unknown): unknown => {
    if (Array.isArray(each)) return each.map(strip);
    if (each && typeof each === "object") {
      return Object.fromEntries(Object.entries(each).filter(([key]) => key !== "tokens").map(([key, inner]) => [key, strip(inner)]));
    }
    return each;
  };
  const run: Record<string, unknown> = { ...value.run };
  for (const later of ["suite", "label", "developer", "host", "parent_run", "prompt_versions", "attributes"]) delete run[later];
  return strip({ ...value, schema_version: `mystery-eval-result/${version}`, run });
}

/** Writes a run folder as a run leaves it: the subject's result, then `run.json` unless `stopped`. */
function writeRun(root: string, result: unknown, options: { stopped?: boolean } = {}): string {
  const value = result as Result;
  const dir = path.join(root, value.run.id);
  fs.mkdirSync(path.join(dir, "00-lighthouse"), { recursive: true });
  fs.writeFileSync(path.join(dir, "00-lighthouse", "result.json"), JSON.stringify(result));
  if (!options.stopped) {
    const subject = { kind: value.subject.kind, id: value.subject.id, dir: "00-lighthouse", summary: value.summary, run_error: value.run_error };
    fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify({ schema_version: value.schema_version, run: value.run, subjects: [subject], exit_code: 0 }));
  }
  return dir;
}

/** A run folder of version 3 with the `record.json` `finish()` writes beside it. */
async function writeRecordedRun(run: RunInfo): Promise<RunRecord> {
  const dir = writeRun(outputRoot, blueprintResult(run));
  const record = await recordFromFolder(dir, "local");
  writeRecord(dir, record);
  return record;
}

/** Puts `records` into the remote, as another developer's `perf push` would. */
function publish(...records: RunRecord[]): void {
  publishRecords({
    clone: path.join(scratch, "other-clone"),
    remote,
    files: records.map((record) => ({ path: recordPath(record), content: `${JSON.stringify(record, null, 2)}\n` })),
    author: "other",
  });
}

async function sync(...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runEval(["perf", "sync", "--config", configFile, "--output-root", outputRoot, ...args], { root: ROOT, out: (t) => out.push(t), err: (t) => err.push(t), env: {} }, COMMANDS);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

function writeConfig(perf: unknown): void {
  fs.writeFileSync(configFile, JSON.stringify({ developer: "ada", ...(perf === undefined ? {} : { perf }) }));
}

const TABLES = ["runs", "subjects", "calls", "verdicts"] as const;

/** Every row of every table, in key order. */
function rows(table: (typeof TABLES)[number]): Array<Record<string, unknown>> {
  const db = openDatabase({ path: path.join(outputRoot, INDEX_FILE), readonly: true });
  try {
    return db.prepare(`select * from ${table} order by run${table === "runs" ? "" : ", " + (table === "subjects" ? "position" : "n")}`).all();
  } finally {
    db.close();
  }
}

function everything() {
  return Object.fromEntries(TABLES.map((table) => [table, rows(table)]));
}

beforeEach(() => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "eval-perf-sync-")));
  outputRoot = path.join(scratch, "runs");
  fs.mkdirSync(outputRoot);
  configFile = path.join(scratch, "config.json");
  remote = makeRemote();
  writeConfig({ remote });
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

const V1 = "2026-05-01/10-00-00-generate";
const V2 = "2026-06-01/10-00-00-generate";
const V3 = "2026-11-25/10-00-00-generate";

async function historyAndRecords() {
  writeRun(outputRoot, asVersion(blueprintResult(runInfo(V1, "ada")), 1));
  writeRun(outputRoot, asVersion(blueprintResult(runInfo(V2, "ada")), 2));
  await writeRecordedRun(runInfo(V3, "ada", { prompt_versions: { narrator: "000000000002", generator: "aaaaaaaaaaa2" } }));
}

describe("perf sync rows", () => {
  it("indexes runs of result versions 1, 2 and 3, the old ones with the new fields empty", async () => {
    await historyAndRecords();
    const result = await sync();

    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out).toContain("indexed 3 run(s) (3 local, 0 shared, 0 in both): 3 subject(s), 6 call(s), 3 verdict(s)");
    const runs = rows("runs");
    expect(runs.map((run) => [run.run, run.run_id, run.developer, run.loop, run.source, run.result_version])).toEqual([
      [1, V1, "ada", "blueprint", "local", "mystery-eval-result/1"],
      [2, V2, "ada", "blueprint", "local", "mystery-eval-result/2"],
      [3, V3, "ada", "blueprint", "local", "mystery-eval-result/3"],
    ]);
    for (const old of runs.slice(0, 2)) {
      expect(old).toMatchObject({ suite: null, label: null, host: null, parent_run: null, narrator_prompt: null, narrator_prompt_seq: null, generator_prompt: null, attributes: null });
    }
    expect(runs[2]).toMatchObject({ suite: "blueprint-loop", label: "try", host: "lab", comparable: 1, tree_clean: 1, exit_code: 0, narrator_prompt: "000000000002", generator_prompt: "aaaaaaaaaaa2" });

    expect(rows("subjects").map((subject) => [subject.run, subject.position, subject.kind, subject.subject_id, subject.passed])).toEqual([
      [1, 0, "blueprint", "lighthouse", 1],
      [2, 0, "blueprint", "lighthouse", 1],
      [3, 0, "blueprint", "lighthouse", 1],
    ]);
    expect(rows("calls").map((call) => [call.run, call.role, call.judge, call.model, call.tokens_input, call.tokens_cache_read])).toEqual([
      [1, "generator", null, "opus", null, null],
      [1, "judge", "cg_soundness", "opus", null, null],
      [2, "generator", null, "opus", null, null],
      [2, "judge", "cg_soundness", "opus", null, null],
      [3, "generator", null, "opus", 100, 3000],
      [3, "judge", "cg_soundness", "opus", 100, 3000],
    ]);
    expect(rows("verdicts").map((verdict) => [verdict.run, verdict.verdict, verdict.status, verdict.findings])).toEqual([
      [1, "cg_soundness", "pass", 2],
      [2, "cg_soundness", "pass", 2],
      [3, "cg_soundness", "pass", 2],
    ]);
  });

  it("numbers each prompt version by when it was first seen, whatever order the runs are found in", async () => {
    const first = runInfo("2026-06-01/10-00-00-generate", "ada", { prompt_versions: { narrator: "00000000000b", generator: "aaaaaaaaaaaa" } });
    const second = runInfo("2026-07-01/10-00-00-generate", "ada", { prompt_versions: { narrator: "00000000000a", generator: "aaaaaaaaaaaa" } });
    const third = runInfo("2026-08-01/10-00-00-generate", "ada", { prompt_versions: { narrator: "00000000000b", generator: "bbbbbbbbbbbb" } });
    for (const info of [third, first, second]) await writeRecordedRun(info);
    await sync();

    expect(rows("runs").map((run) => [String(run.run_id).slice(0, 10), run.narrator_prompt_seq, run.generator_prompt_seq])).toEqual([
      ["2026-06-01", 1, 1],
      ["2026-07-01", 2, 1],
      ["2026-08-01", 1, 2],
    ]);
  });

  it("gives each command its loop, and leaves other commands out", async () => {
    expect(["generate", "judge blueprint"].map(loopOf)).toEqual(["blueprint", "blueprint"]);
    expect(["judge turn", "play", "judge game"].map(loopOf)).toEqual(["narration", "narration", "narration"]);
    expect(["validate", "cases", "baseline status", "report"].map(loopOf)).toEqual([null, null, null, null]);

    await writeRecordedRun(runInfo("2026-11-25/10-00-00-generate", "ada"));
    await writeRecordedRun(runInfo("2026-11-25/11-00-00-play", "ada", { command: "play" }));
    await writeRecordedRun(runInfo("2026-11-25/12-00-00-validate", "ada", { command: "validate" }));
    const result = await sync();

    expect(rows("runs").map((run) => [run.command, run.loop])).toEqual([["generate", "blueprint"], ["play", "narration"]]);
    expect(result.out).toContain("1 run(s) of other commands are not indexed");
  });

  it("gives the same rows after perf.db is deleted and synced again, and replaces an index of another shape", async () => {
    await historyAndRecords();
    publish(await recordFromFolder(writeRun(path.join(scratch, "elsewhere"), blueprintResult(runInfo("2026-11-26/09-00-00-generate", "bob"))), "bob"));
    await sync();
    const before = everything();
    expect(before.runs).toHaveLength(4);

    fs.rmSync(path.join(outputRoot, INDEX_FILE));
    await sync();
    expect(everything()).toEqual(before);

    await sync();
    expect(everything()).toEqual(before);

    fs.writeFileSync(path.join(outputRoot, INDEX_FILE), "not a database");
    await sync();
    expect(everything()).toEqual(before);
    expect(fs.readdirSync(outputRoot).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps the index it had when a rebuild fails", () => {
    const file = path.join(outputRoot, INDEX_FILE);
    fs.writeFileSync(file, "last index");
    const broken = { record: { run: runInfo(V3, "ada"), subjects: [], calls: [], verdicts: [], exit_code: 0, comparable: true, result_version: "mystery-eval-result/3" }, source: "local" } as unknown as Parameters<typeof buildIndex>[1][number];
    expect(() => buildIndex(file, [broken, broken])).toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe("last index");
    expect(fs.readdirSync(outputRoot)).toEqual([INDEX_FILE]);
  });
});

describe("perf sync and the data repository", () => {
  it("indexes everyone's fetched records beside the local runs", async () => {
    await writeRecordedRun(runInfo(V3, "ada"));
    publish(await recordFromFolder(writeRun(path.join(scratch, "elsewhere"), blueprintResult(runInfo("2026-11-26/09-00-00-generate", "bob"))), "bob"));
    const result = await sync();

    expect(result.code).toBe(0);
    expect(result.out).toContain("indexed 2 run(s) (1 local, 1 shared, 0 in both)");
    expect(fs.existsSync(path.join(dataCloneDir(outputRoot), ".git"))).toBe(true);
    expect(rows("runs").map((run) => [run.developer, run.source])).toEqual([["ada", "local"], ["bob", "shared"]]);
  });

  it("indexes a run held both in a folder here and in the data repository once", async () => {
    const mine = await writeRecordedRun(runInfo(V3, "ada"));
    publish(mine);
    const result = await sync();

    expect(result.out).toContain("indexed 1 run(s) (0 local, 0 shared, 1 in both): 1 subject(s), 2 call(s), 1 verdict(s)");
    expect(rows("runs").map((run) => run.source)).toEqual(["both"]);
    expect(rows("calls")).toHaveLength(2);
  });

  it("tells runs of different developers apart even when their ids are the same", async () => {
    await writeRecordedRun(runInfo(V3, "ada"));
    publish(await recordFromFolder(writeRun(path.join(scratch, "elsewhere"), blueprintResult(runInfo(V3, "bob"))), "bob"));
    await sync();

    expect(rows("runs").map((run) => [run.run_id, run.developer, run.source])).toEqual([[V3, "ada", "local"], [V3, "bob", "shared"]]);
  });

  it("builds from the run folders and the last fetch when the remote cannot be reached, and says so", async () => {
    await writeRecordedRun(runInfo(V3, "ada"));
    publish(await recordFromFolder(writeRun(path.join(scratch, "elsewhere"), blueprintResult(runInfo("2026-11-26/09-00-00-generate", "bob"))), "bob"));
    await sync();

    fs.rmSync(remote, { recursive: true, force: true });
    const result = await sync();

    expect(result.code).toBe(0);
    expect(result.err).toContain(`could not fetch ${remote}`);
    expect(result.err).toContain("indexing the run folders and the last fetch");
    expect(rows("runs").map((run) => [run.developer, run.source])).toEqual([["ada", "local"], ["bob", "shared"]]);
  });

  it("builds from the run folders when the remote cannot be reached and nothing was ever fetched", async () => {
    await writeRecordedRun(runInfo(V3, "ada"));
    writeConfig({ remote: path.join(scratch, "missing.git") });
    const result = await sync();

    expect(result.code).toBe(0);
    expect(result.err).toContain("could not fetch");
    expect(rows("runs")).toHaveLength(1);
  });

  it("builds from the run folders and says nothing was fetched without perf.remote", async () => {
    await writeRecordedRun(runInfo(V3, "ada"));
    writeConfig(undefined);
    const result = await sync();

    expect(result.code).toBe(0);
    expect(result.out).toContain("perf.remote is not set: nothing fetched");
    expect(fs.existsSync(dataCloneDir(outputRoot))).toBe(false);
    expect(rows("runs")).toHaveLength(1);
  });
});

describe("perf sync folders", () => {
  it("reports a run folder it cannot read once, by path, and indexes the rest", async () => {
    await writeRecordedRun(runInfo(V3, "ada"));
    const bad = path.join(outputRoot, "2026-11-25", "11-00-00-play");
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(path.join(bad, "run.json"), "{ not json");
    const badRecord = path.join(outputRoot, "2026-11-25", "12-00-00-generate");
    fs.mkdirSync(badRecord, { recursive: true });
    fs.writeFileSync(path.join(badRecord, "record.json"), JSON.stringify({ schema_version: "mystery-eval-record/1" }));
    const result = await sync();

    expect(result.code).toBe(1);
    const lines = result.err.split("\n").filter((line) => line.startsWith("[perf sync]"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(`skipped, unreadable: ${path.join("2026-11-25", "11-00-00-play")}:`);
    expect(lines[1]).toContain(`skipped, unreadable: ${path.join("2026-11-25", "12-00-00-generate")}:`);
    expect(rows("runs").map((run) => run.run_id)).toEqual([V3]);
  });

  it("reports a record in the data repository it cannot read", async () => {
    const mine = await writeRecordedRun(runInfo(V3, "ada"));
    publish(mine);
    publishRecords({ clone: path.join(scratch, "other-clone"), remote, files: [{ path: "records/2026/11/bob/broken.json", content: "{}\n" }], author: "other" });
    const result = await sync();

    expect(result.code).toBe(1);
    expect(result.err).toContain("skipped, unreadable: data repository: records/2026/11/bob/broken.json");
    expect(rows("runs")).toHaveLength(1);
  });

  it("skips what is not a run folder without a word: old suites, older result layouts and empty folders", async () => {
    await writeRecordedRun(runInfo(V3, "ada"));
    fs.mkdirSync(path.join(outputRoot, "suites", "game-side"), { recursive: true });
    fs.writeFileSync(path.join(outputRoot, "suites", "game-side", "calls.jsonl"), "{}\n");
    const older = path.join(outputRoot, "2026-05-31", "13-38-41Z", "run-small-floating-market");
    fs.mkdirSync(older, { recursive: true });
    fs.writeFileSync(path.join(older, "result.json"), JSON.stringify({ schema_version: "0.2", run_id: "x" }));
    fs.mkdirSync(path.join(outputRoot, "2026-05-30", "evaluators-small-floating-market"), { recursive: true });
    fs.mkdirSync(path.join(outputRoot, "2026-05-30", "03-04-05-play"), { recursive: true });
    const result = await sync();

    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(rows("runs").map((run) => run.run_id)).toEqual([V3]);
  });

  it("indexes a run stopped before it wrote run.json from its results", async () => {
    writeRun(outputRoot, blueprintResult(runInfo(V3, "ada")), { stopped: true });
    const result = await sync();

    expect(result.code).toBe(0);
    expect(rows("runs").map((run) => [run.run_id, run.developer, run.exit_code])).toEqual([[V3, "ada", null]]);
  });

  it("makes an index with empty tables when there is nothing to index, and refuses arguments", async () => {
    expect((await sync()).out).toContain("indexed 0 run(s)");
    expect(everything()).toEqual({ runs: [], subjects: [], calls: [], verdicts: [] });
    const extra = await sync("extra");
    expect(extra.code).toBe(1);
    expect(extra.err).toContain("extra");
  });
});
