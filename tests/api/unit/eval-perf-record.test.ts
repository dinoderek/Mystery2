// The run record: what `record.json` holds for runs of every result version,
// how calls get their role and rounds flatten into rows, when a run is
// comparable, and that no prompt, answer, finding or log text reaches it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ResolvedBinding } from "../../../evaluation/core/config.ts";
import { RESULT_SCHEMA_VERSION, summarize, writeResult } from "../../../evaluation/core/result.ts";
import type { ModelCall, Result, Round, RunInfo, Subject, Verdict } from "../../../evaluation/core/result.ts";
import { createRunFolder, recordFromFolder } from "../../../evaluation/core/run-folder.ts";
import { osUserName } from "../../../evaluation/core/run-identity.ts";
import {
  RECORD_FILE,
  RECORD_SCHEMA_VERSION,
  RunRecordSchema,
  buildRecord,
  readRecord,
  writeRecord,
} from "../../../evaluation/perf/record.ts";
import type { RecordSource } from "../../../evaluation/perf/record.ts";

let scratch = "";

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "eval-perf-record-"));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

const TOKENS = { input: 100, output: 20, cache_read: 3000, cache_write: 40 };

function modelCall(binding: string, model: string | null, extra: Partial<ModelCall> = {}): ModelCall {
  return {
    binding,
    model,
    prompt_sha256: "c".repeat(64),
    duration_ms: 1500,
    cost_usd: 0.25,
    tokens: TOKENS,
    attempts: [
      { attempt: 1, outcome: "invalid", duration_ms: 500, cost_usd: 0.1, tokens: TOKENS, error: "MARKER-ATTEMPT-ERROR" },
      { attempt: 2, outcome: "ok", duration_ms: 1000, cost_usd: 0.15, tokens: TOKENS },
    ],
    ...extra,
  };
}

function judged(id: string, status: Verdict["status"], extra: Partial<Verdict> = {}): Verdict {
  return {
    id,
    tier: "judge",
    status,
    findings: ["MARKER-FINDING one", { quote: "MARKER-FINDING two" }],
    details: { note: "MARKER-DETAILS" },
    call: modelCall("blueprint-judge", "opus"),
    answer: { verdict: status, why: "MARKER-ANSWER" },
    ...extra,
  };
}

function check(id: string, status: Verdict["status"] = "pass"): Verdict {
  return { id, tier: "mechanical", status, details: { note: "MARKER-DETAILS" } };
}

function runInfo(extra: Partial<RunInfo> = {}): RunInfo {
  return {
    id: "2026-11-25/10-00-00-generate",
    command: "generate",
    argv: ["brief.json"],
    started_at: "2026-11-25T10:00:00.000Z",
    ended_at: "2026-11-25T10:05:00.000Z",
    commit: "abc",
    tree_clean: true,
    bindings: {},
    judge_versions: { cg_soundness: 1, cg_step_sense: null },
    suite: "blueprint-loop",
    label: null,
    developer: "ada",
    host: "lab",
    parent_run: null,
    prompt_versions: { narrator: "0123456789ab", generator: "ba9876543210" },
    attributes: null,
    ...extra,
  };
}

function result(subject: Pick<Subject, "kind" | "id">, verdicts: Verdict[], extra: Partial<Result> = {}): Result {
  const runError = extra.run_error ?? null;
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    run: runInfo(),
    subject: { ...subject, path: null },
    production: null,
    verdicts,
    summary: summarize(verdicts, runError),
    run_error: runError,
    timing: { total_ms: 1, stages: [{ name: "judge", duration_ms: 1, detail: { note: "MARKER-TIMING" } }] },
    ...extra,
  };
}

function round(n: number, verdicts: Verdict[]): Round {
  return {
    round: n,
    path: n === 0 ? "blueprint.json" : `rounds/${n}/blueprint.json`,
    call: modelCall("generator-agent", "opus", { duration_ms: 1000 + n }),
    verdicts,
    summary: summarize(verdicts),
    cost_usd: 0.5,
    timing: null,
  };
}

/** A result as an earlier version wrote it: version 2 without tokens, version 1 also without rounds. */
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
  const older = strip({ ...value, schema_version: `mystery-eval-result/${version}`, run }) as Record<string, unknown>;
  if (version === 1) delete older.rounds;
  return older;
}

/** Writes a run folder as a run leaves it: each subject's result and logs, then `run.json` unless `stopped`. */
function writeRunFolder(name: string, results: unknown[], options: { stopped?: boolean; exitCode?: number } = {}): string {
  const dir = path.join(scratch, name);
  const subjects = results.map((each, index) => {
    const value = each as Result;
    const sub = `${String(index).padStart(2, "0")}-${value.subject.id}`;
    fs.mkdirSync(path.join(dir, sub, "logs"), { recursive: true });
    fs.writeFileSync(path.join(dir, sub, "result.json"), JSON.stringify(each));
    fs.writeFileSync(path.join(dir, sub, "logs", "system.md"), "MARKER-PROMPT");
    return { kind: value.subject.kind, id: value.subject.id, dir: sub, summary: value.summary, run_error: value.run_error };
  });
  if (!options.stopped) {
    const first = results[0] as Result;
    fs.writeFileSync(
      path.join(dir, "run.json"),
      JSON.stringify({ schema_version: first.schema_version, run: first.run, subjects, exit_code: options.exitCode ?? 0 }),
    );
  }
  return dir;
}

describe("a record built from a run folder", () => {
  const repaired = () =>
    result({ kind: "blueprint", id: "lighthouse" }, [check("clue_graph_valid"), judged("cg_soundness", "pass")], {
      subject: { kind: "blueprint", id: "lighthouse", path: "rounds/1/blueprint.json" },
      production: { calls: [round(0, []).call, round(1, []).call] },
      rounds: [round(0, [check("clue_graph_valid"), judged("cg_soundness", "fail")]), round(1, [check("clue_graph_valid"), judged("cg_soundness", "pass")])],
    });

  it("from version 3 holds the run block whole, each subject, and tokens on its calls", async () => {
    const dir = writeRunFolder("v3", [repaired()]);
    const record = await recordFromFolder(dir, "local");

    expect(RunRecordSchema.parse(record)).toEqual(record);
    expect(record).toMatchObject({ schema_version: RECORD_SCHEMA_VERSION, result_version: "mystery-eval-result/3", exit_code: 0, comparable: true });
    expect(record.run).toEqual(runInfo());
    expect(record.subjects).toEqual([{ kind: "blueprint", id: "lighthouse", passed: true, rounds: 2, run_error_stage: null }]);
    expect(record.calls[0]).toEqual({
      subject: 0,
      round: 0,
      role: "generator",
      judge: null,
      judge_version: null,
      binding: "generator-agent",
      model: "opus",
      duration_ms: 1000,
      cost_usd: 0.25,
      tokens: TOKENS,
      attempts: 2,
      outcome: "ok",
    });
  });

  it("from version 2 flattens rounds by round number and records null tokens", async () => {
    const dir = writeRunFolder("v2", [asVersion(repaired(), 2)]);
    const record = await recordFromFolder(dir, "local");

    expect(record.result_version).toBe("mystery-eval-result/2");
    expect(record.run).toMatchObject({ suite: null, label: null, host: null, prompt_versions: null, attributes: null, developer: "local" });
    expect(record.calls.map((call) => [call.round, call.role, call.judge, call.judge_version, call.tokens])).toEqual([
      [0, "generator", null, null, null],
      [0, "judge", "cg_soundness", 1, null],
      [1, "generator", null, null, null],
      [1, "judge", "cg_soundness", 1, null],
    ]);
    expect(record.verdicts.map((verdict) => [verdict.round, verdict.id, verdict.status, verdict.judge_version, verdict.findings])).toEqual([
      [0, "clue_graph_valid", "pass", null, null],
      [0, "cg_soundness", "fail", 1, 2],
      [1, "clue_graph_valid", "pass", null, null],
      [1, "cg_soundness", "pass", 1, 2],
    ]);
  });

  it("from version 1 reads its production calls and verdicts with no round, and its analyzer verdicts", async () => {
    const generated = result({ kind: "blueprint", id: "fete" }, [check("schema"), { id: "clue_graph.analyzer", tier: "analyzer", status: "pass" }, judged("cg_soundness", "pass")], {
      production: { calls: [modelCall("generator-agent", "opus")] },
    });
    const dir = writeRunFolder("v1", [asVersion(generated, 1)]);
    const record = await recordFromFolder(dir, "local");

    expect(record.result_version).toBe("mystery-eval-result/1");
    expect(record.subjects[0].rounds).toBeNull();
    expect(record.calls.map((call) => [call.round, call.role, call.judge])).toEqual([
      [null, "generator", null],
      [null, "judge", "cg_soundness"],
    ]);
    expect(record.verdicts.map((verdict) => [verdict.round, verdict.tier])).toEqual([
      [null, "mechanical"],
      [null, "analyzer"],
      [null, "judge"],
    ]);
  });

  it("from a run stopped before it wrote run.json takes the latest run block and no exit code", async () => {
    const early = result({ kind: "turn", id: "case-1" }, [check("flesch")], { run: runInfo({ command: "judge turn", ended_at: "2026-11-25T10:01:00.000Z" }) });
    const late = result({ kind: "turn", id: "case-2" }, [check("flesch")], { run: runInfo({ command: "judge turn", ended_at: "2026-11-25T10:02:00.000Z" }) });
    const dir = writeRunFolder("stopped", [early, late], { stopped: true });
    const record = await recordFromFolder(dir, "local");

    expect(record.exit_code).toBeNull();
    expect(record.run.ended_at).toBe("2026-11-25T10:02:00.000Z");
    expect(record.subjects.map((subject) => subject.id)).toEqual(["case-1", "case-2"]);
  });

  it("refuses a folder with neither run.json nor a result", async () => {
    fs.mkdirSync(path.join(scratch, "empty", "notes"), { recursive: true });
    await expect(recordFromFolder(path.join(scratch, "empty"), "local")).rejects.toThrow(/has no run.json and no subject with a result.json/);
  });

  it("holds no text from the prompts, answers, findings, reasons, errors or logs", async () => {
    const broken = result({ kind: "blueprint", id: "lantern" }, [judged("cg_soundness", "error", { reason: "MARKER-REASON" })], {
      production: { calls: [modelCall("generator-agent", "opus")] },
      run_error: { stage: "judge", message: "MARKER-RUN-ERROR" },
    });
    const dir = writeRunFolder("markers", [repaired(), broken], { exitCode: 1 });
    const record = await recordFromFolder(dir, "local");

    expect(fs.readFileSync(path.join(dir, "01-lantern", "result.json"), "utf8")).toContain("MARKER-");
    expect(JSON.stringify(record)).not.toContain("MARKER");
    expect(record.subjects[1]).toMatchObject({ passed: false, run_error_stage: "judge" });
  });
});

describe("call roles", () => {
  it("names a turn's production call the narrator's, and a game's the narrator's on the server binding, else the investigator's", () => {
    const turn = result({ kind: "turn", id: "case-1" }, [judged("gm_broad", "pass", { call: modelCall("turn-judge", "sonnet") })], {
      production: { calls: [modelCall("narrator-claude", "haiku")] },
    });
    const game = result({ kind: "game", id: "g-1" }, [], {
      production: { calls: [modelCall("investigator", "sonnet"), modelCall("server", "claude-haiku")] },
    });
    const record = buildRecord({ result_version: RESULT_SCHEMA_VERSION, run: runInfo({ judge_versions: { gm_broad: 7 } }), exit_code: 0, results: [turn, game] }, "local");

    expect(record.calls.map((call) => [call.subject, call.role, call.binding, call.judge_version])).toEqual([
      [0, "narrator", "narrator-claude", null],
      [0, "judge", "turn-judge", 7],
      [1, "investigator", "investigator", null],
      [1, "narrator", "server", null],
    ]);
  });

  it("counts a repair round that broke before it was judged as a generator call of the next round", () => {
    const first = round(0, [check("clue_graph_valid", "fail")]);
    const broke = modelCall("generator-agent", "opus", { attempts: [{ attempt: 1, outcome: "timeout", duration_ms: 9, cost_usd: null, tokens: null }] });
    const value = result({ kind: "blueprint", id: "lighthouse" }, first.verdicts, {
      subject: { kind: "blueprint", id: "lighthouse", path: "blueprint.json" },
      production: { calls: [first.call, broke] },
      rounds: [first],
      run_error: { stage: "repair_round_1", message: "timed out" },
    });
    const record = buildRecord({ result_version: RESULT_SCHEMA_VERSION, run: runInfo(), exit_code: 1, results: [value] }, "local");

    expect(record.calls.map((call) => [call.round, call.role, call.outcome])).toEqual([
      [0, "generator", "ok"],
      [1, "generator", "timeout"],
    ]);
    expect(record.subjects[0]).toMatchObject({ rounds: 1, run_error_stage: "repair_round_1" });
  });
});

describe("comparable", () => {
  const source = (run: Partial<RunInfo>, verdicts: Verdict[]): RecordSource => ({
    result_version: RESULT_SCHEMA_VERSION,
    run: runInfo(run),
    exit_code: 0,
    results: [result({ kind: "blueprint", id: "x" }, verdicts)],
  });

  it("is true for a clean tree whose judges all had a version", () => {
    expect(buildRecord(source({}, [check("clue_graph_valid"), judged("cg_soundness", "fail")]), "local").comparable).toBe(true);
  });

  it.each([
    ["a dirty tree", { tree_clean: false }, [judged("cg_soundness", "pass")]],
    ["a tree whose state is unknown", { tree_clean: null }, [judged("cg_soundness", "pass")]],
    ["a judge whose version was null", {}, [judged("cg_step_sense", "pass")]],
    ["a judge the run recorded no version for", { judge_versions: {} }, [judged("cg_soundness", "fail")]],
  ] as const)("is false for %s", (_label, run, verdicts) => {
    expect(buildRecord(source(run, [...verdicts]), "local").comparable).toBe(false);
  });

  it("ignores a judge with no version that gave no verdict", () => {
    const record = buildRecord(source({}, [judged("cg_step_sense", "error"), judged("cg_step_sense_2", "skipped")]), "local");
    expect(record.comparable).toBe(true);
    expect(record.verdicts.map((verdict) => verdict.judge_version)).toEqual([null, null]);
  });
});

describe("who ran it", () => {
  it("keeps the developer the run recorded, and takes the local one when it recorded none", () => {
    const value = result({ kind: "blueprint", id: "x" }, []);
    const recorded = buildRecord({ result_version: RESULT_SCHEMA_VERSION, run: runInfo(), exit_code: 0, results: [value] }, "local");
    const unrecorded = buildRecord({ result_version: RESULT_SCHEMA_VERSION, run: runInfo({ developer: null }), exit_code: 0, results: [value] }, "local");
    expect([recorded.run.developer, unrecorded.run.developer]).toEqual(["ada", "local"]);
  });
});

describe("the record file", () => {
  const binding: ResolvedBinding = {
    name: "blueprint-judge",
    cmd: "w.sh",
    command: "/abs/w.sh",
    args: ["{{user_message_file}}"],
    extract_path: "result",
    model: "opus",
    timeout_ms: 5,
    retries: 1,
  };

  it("is written by finish() beside run.json, and parses against the schema", async () => {
    const run = createRunFolder({
      outputRoot: scratch,
      command: "judge blueprint",
      argv: ["b.json"],
      root: scratch,
      bindings: [binding],
      identity: { suite: null, label: "try", developer: "ada", parent_run: null },
      commit: { commit: "abc", tree_clean: true },
    });
    const folder = run.subject({ kind: "blueprint", id: "lighthouse" });
    await writeResult(folder.resultFile, result({ kind: "blueprint", id: "lighthouse" }, [judged("cg_soundness", "fail")], { run: run.info() }));
    const index = await run.finish();

    const record = readRecord(run.dir);
    expect(record).toEqual(await recordFromFolder(run.dir, "someone-else"));
    expect(record).toMatchObject({ exit_code: index.exit_code, run: { ...index.run, developer: "ada", label: "try" } });
    expect(record.calls).toHaveLength(1);
    expect(fs.existsSync(path.join(run.dir, RECORD_FILE))).toBe(true);
  });

  it("names the OS user when finish() runs without an identity", async () => {
    const run = createRunFolder({ outputRoot: scratch, command: "judge blueprint", argv: [], root: scratch, bindings: [], commit: { commit: null, tree_clean: null } });
    const folder = run.subject({ kind: "blueprint", id: "lighthouse" });
    await writeResult(folder.resultFile, result({ kind: "blueprint", id: "lighthouse" }, [], { run: run.info() }));
    await run.finish();
    expect(readRecord(run.dir).run.developer).toBe(osUserName());
  });

  it("is never replaced, and is refused when a row names a subject that is not there", () => {
    const record = buildRecord({ result_version: RESULT_SCHEMA_VERSION, run: runInfo(), exit_code: 0, results: [result({ kind: "blueprint", id: "x" }, [judged("cg_soundness", "pass")])] }, "local");
    writeRecord(scratch, record);
    expect(() => writeRecord(scratch, record)).toThrow(/EEXIST/);
    expect(() => writeRecord(path.join(scratch, "other"), { ...record, subjects: [] })).toThrow(/subject 0 is not in subjects/);
  });
});
