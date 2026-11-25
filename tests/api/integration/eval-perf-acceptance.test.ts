// Evaluation performance, end to end: every run command, the two committed
// baseline suites, `perf push`, `perf sync` and `perf report` run in one output
// root, in the order a developer would run them, and each claim below reads
// what they left there.
//
// No model is called and nothing leaves the machine. Every binding is a stub
// behind `usage-wrapper.mjs`, which reports token usage as the Claude CLI does;
// the server narrator is the game's mock, on the suite's build
// (`MYSTERY_TEST_BUILD_DIR`); the data repository is a local bare repository.
//
// The checkout reads as clean to the runs, as a baseline is only ever made from
// a clean tree (`perf baseline` refuses any other), so the runs are comparable
// and land on trend lines whatever the working tree holds while the gate runs.
// Only `git status --porcelain` on this checkout is answered so; the commit,
// and every other git command, are real.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import type { EvalCommand } from "../../../evaluation/core/dispatch.ts";
import { readResult } from "../../../evaluation/core/result.ts";
import type { Result } from "../../../evaluation/core/result.ts";
import { generateCommand } from "../../../evaluation/generate/commands.ts";
import { recordPath } from "../../../evaluation/perf/data-repo.ts";
import { INDEX_FILE } from "../../../evaluation/perf/index-db.ts";
import { RECORD_FILE, readRecord, writeRecord } from "../../../evaluation/perf/record.ts";
import type { RunRecord } from "../../../evaluation/perf/record.ts";
import { REPORT_DIR, REPORT_FILE } from "../../../evaluation/perf/report.ts";
import { ATTRIBUTE_NAMES, readReport } from "../../../evaluation/perf/report-data.ts";
import type { AttributeName } from "../../../evaluation/perf/report-data.ts";
import { runFolders } from "../../../evaluation/perf/run-folders.ts";
import { readSuite, SUITES_DIR } from "../../../evaluation/perf/baseline.ts";
import { createPlayCommand } from "../../../evaluation/playtest/play.ts";
import { createJudgeTurnCommand } from "../../../evaluation/runtime/judge-turn.ts";
import type { StartServer, ThrowawayServer } from "../../../evaluation/runtime/lib/replay-server.ts";
import { openDatabase } from "../../../packages/game-engine/src/db/client.ts";
import { startTestServer } from "../../../scripts/lib/test-server.mjs";
import { floors, sizedCase } from "../unit/fixtures/clue-graph-sized.ts";

const ROOT = process.cwd();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const execFileSync = ((file: string, args?: readonly string[], options?: { cwd?: string }) =>
    file === "git" && args?.[0] === "status" && args[1] === "--porcelain" && path.resolve(options?.cwd ?? ".") === process.cwd()
      ? ""
      : actual.execFileSync(file, args as string[], options as never)) as typeof actual.execFileSync;
  return { ...actual, execFileSync, default: { ...actual, execFileSync } };
});

const WRAPPER = path.join(ROOT, "tests/api/integration/usage-wrapper.mjs");
const STUB_INVESTIGATOR = path.join(ROOT, "tests/api/integration/stub-investigator.mjs");
const STUB_GAME_JUDGE = path.join(ROOT, "tests/api/unit/trace-mock-judge.mjs");
const BRIEFS = "blueprints/clue-graph/briefs";
const TURN_CASES = "evaluation/runtime/cases/clue-graph/mock-case/readability.ts";
const JUDGED_CASE = "blueprints/clue-graph/greenhouse-prizewinner.json";
/** The tokens `usage-wrapper.mjs` reports for every call, and their sum, which the report gives per call. */
const TOKENS = { input: 120, output: 30, cache_read: 400, cache_write: 50 };
const TOKENS_ADDED = Object.values(TOKENS).reduce((sum, each) => sum + each, 0);
/** The committed baseline suites, which the counts below follow. */
const BLUEPRINT_SUITE = readSuite(path.join(ROOT, SUITES_DIR), "blueprint-loop");
const NARRATION_SUITE = readSuite(path.join(ROOT, SUITES_DIR), "narration-loop");
/** A run folder per suite run: the blueprint suite's one run judges all its briefs. */
const BASELINE_RUNS = BLUEPRINT_SUITE.runs.length + NARRATION_SUITE.runs.length;
/** The records `perf push` finds sent or to send: the baselines', generate's, judge blueprint's and play's. */
const RECORDS = BASELINE_RUNS + 3;
const PROMPT_FILES = ["{{system_prompt_file}}", "{{user_message_file}}"];

let scratch = "";
let outputRoot = "";
let remote = "";
let config = "";

/** Every run folder this test made, by what made it. */
const runs = {} as Record<"blueprintBaseline" | "narrationBaseline" | "generate" | "judgeBlueprint" | "serverTurn" | "play" | "history", string[]>;
/** What the commands printed, by step. */
const printed: Record<string, { code: number; out: string; err: string }> = {};
/** Each record as its run left it, by run folder. */
const written = new Map<string, string>();
/** Records the data repository held after the baselines, before `perf push`. */
let pushedByBaselines: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@localhost", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function remoteRecords(): string[] {
  return git(remote, "ls-tree", "-r", "--name-only", "main").split("\n").filter((file) => file.startsWith("records/")).sort();
}

/** The generator: answers each brief with a case of the brief's size and age, and that case again in every repair round. */
function writeGenerator(): string {
  const cases: Record<string, unknown> = {};
  for (const file of fs.readdirSync(path.join(ROOT, BRIEFS))) {
    const brief = JSON.parse(fs.readFileSync(path.join(ROOT, BRIEFS, file), "utf8"));
    const made = sizedCase(floors(brief.size), brief.size);
    cases[brief.size] = { ...made, metadata: { ...made.metadata, target_age: brief.targetAge, title: brief.titleHint } };
  }
  const answers = path.join(scratch, "generator-answers.json");
  fs.writeFileSync(answers, JSON.stringify(cases));
  const script = path.join(scratch, "generator.mjs");
  fs.writeFileSync(
    script,
    `import fs from "node:fs";
     const message = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
     const answer = JSON.parse(fs.readFileSync(${JSON.stringify(answers)}, "utf8"))[message.story_brief.size];
     process.stdout.write(JSON.stringify({ result: JSON.stringify(answer) }));`,
  );
  return script;
}

/** The clue-graph judges: pass every case, answering each judge's own fields from the case it is sent. */
function writeBlueprintJudge(): string {
  const script = path.join(scratch, "blueprint-judge.mjs");
  fs.writeFileSync(
    script,
    `import fs from "node:fs";
     const message = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
     const graph = message.case;
     const answer = { findings: [], verdict: "pass", reasoning: "Sound." };
     if (message.dimension_id === "cg_soundness") answer.conclusions = Object.keys(graph.conclusions).map((conclusion_id) => ({ conclusion_id, follows: "yes", note: "Follows." }));
     if (message.dimension_id === "cg_character_grounding") answer.characters = Object.keys(graph.characters).map((character_id) => ({ character_id, fits: true, note: "Fits." }));
     if (message.dimension_id === "cg_step_sense") answer.steps = message.player_view.steps.map((step) => ({ clue_id: step.clue_id, leads: "yes", note: "Leads." }));
     process.stdout.write(JSON.stringify({ result: JSON.stringify(answer) }));`,
  );
  return script;
}

/** A binding that answers through the usage wrapper, on `model`: as the stub narrator or turn judge, or by running `stub`. */
function binding(mode: "narrate" | "pass" | "add", stub: string[], model: string, extractPath: string | null) {
  return { cmd: process.execPath, args: [WRAPPER, JSON.stringify(TOKENS), mode, ...stub], extract_path: extractPath, model, timeout_ms: 60_000, retries: 0 };
}

function writeConfig(): void {
  const node = (script: string) => [process.execPath, script, ...PROMPT_FILES];
  fs.writeFileSync(
    config,
    JSON.stringify({
      developer: "ada",
      perf: { remote },
      "generator-agent": binding("add", node(writeGenerator()), "local-generator", "result"),
      "blueprint-judge": binding("add", node(writeBlueprintJudge()), "local-judge", "result"),
      "narrator-claude": binding("narrate", ["{{user_message_file}}"], "local-narrator", "result"),
      "turn-judge": binding("pass", ["{{user_message_file}}"], "local-turn-judge", "result"),
      investigator: binding("add", node(STUB_INVESTIGATOR), "local-investigator", null),
      "game-judge": binding("add", node(STUB_GAME_JUDGE), "local-game-judge", "result"),
    }),
  );
}

/** A server of the suite's build, for the server narrator and `play`. */
const startServer: StartServer = async (options) => (await startTestServer({ ...options, build: false })) as ThrowawayServer;

const COMMAND_SET: readonly EvalCommand[] = [
  ...COMMANDS.filter((command) => !["play", "judge turn"].includes(command.name)),
  createPlayCommand({ startServer }),
  createJudgeTurnCommand({ startServer }),
  generateCommand,
];

/** Runs `./dev eval <argv>` on this test's config and output root, and returns the run folders it made. */
async function evalRun(step: string, argv: string[]): Promise<string[]> {
  const before = new Set(runFolders(outputRoot));
  const out: string[] = [];
  const err: string[] = [];
  const code = await runEval([...argv, "--config", config, "--output-root", outputRoot], { root: ROOT, out: (t) => out.push(t), err: (t) => err.push(t), env: process.env }, COMMAND_SET);
  printed[step] = { code, out: out.join("\n"), err: err.join("\n") };
  const made = runFolders(outputRoot).filter((folder) => !before.has(folder));
  for (const folder of made) {
    if (fs.existsSync(path.join(folder, RECORD_FILE))) written.set(folder, fs.readFileSync(path.join(folder, RECORD_FILE), "utf8"));
  }
  return made;
}

/** Every result.json of a run folder's subjects. */
async function resultsOf(folder: string): Promise<Result[]> {
  const index = JSON.parse(fs.readFileSync(path.join(folder, "run.json"), "utf8")) as { subjects: Array<{ dir: string }> };
  return Promise.all(index.subjects.map((subject) => readResult(path.join(folder, subject.dir, "result.json"))));
}

/** A copy of `folder` as an earlier result version wrote it, under a run id of its own: no tokens, none of the later run fields, no record, and for version 1 no rounds. */
function writeAsVersion(folder: string, version: 1 | 2, id: string): string {
  const target = path.join(outputRoot, id);
  fs.cpSync(folder, target, { recursive: true });
  fs.rmSync(path.join(target, RECORD_FILE));
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "tokens").map(([key, inner]) => [key, strip(inner)]));
    return value;
  };
  for (const file of fs.readdirSync(target, { recursive: true, encoding: "utf8" }).filter((each) => /(^|\/)(run|result)\.json$/.test(each))) {
    const full = path.join(target, file);
    const older = strip(JSON.parse(fs.readFileSync(full, "utf8"))) as Record<string, unknown> & { run: Record<string, unknown> };
    for (const later of ["suite", "label", "developer", "host", "parent_run", "prompt_versions", "attributes"]) delete older.run[later];
    older.run.id = id;
    older.schema_version = `mystery-eval-result/${version}`;
    if (version === 1) delete older.rounds;
    fs.writeFileSync(full, JSON.stringify(older));
  }
  return target;
}

/** Every row of the index's four tables, as text, sorted. */
function indexRows(): Record<string, string[]> {
  const db = openDatabase({ path: path.join(outputRoot, INDEX_FILE), readonly: true });
  try {
    return Object.fromEntries(
      ["runs", "subjects", "calls", "verdicts"].map((table) => [table, (db.prepare(`select * from ${table}`).all() as unknown[]).map((row) => JSON.stringify(row)).sort()]),
    );
  } finally {
    db.close();
  }
}

const recordsOf = (folders: readonly string[]): RunRecord[] => folders.map((folder) => readRecord(folder));
const allRunFolders = () => Object.entries(runs).filter(([name]) => name !== "history").flatMap(([, folders]) => folders);

beforeAll(async () => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mystery-eval-perf-acceptance-")));
  // Anything that resolved a config root from the environment would land here.
  vi.stubEnv("MYSTERY_CONFIG_ROOT", fs.mkdtempSync(path.join(scratch, "config-root-")));
  vi.stubEnv("MYSTERY_DATABASE", "");
  outputRoot = path.join(scratch, "runs");
  remote = path.join(scratch, "data.git");
  git(scratch, "init", "--bare", "--quiet", "-b", "main", remote);
  const seed = path.join(scratch, "seed");
  git(scratch, "clone", "--quiet", remote, seed);
  fs.writeFileSync(path.join(seed, "README.md"), "data\n");
  git(seed, "add", "README.md");
  git(seed, "commit", "--quiet", "-m", "README");
  git(seed, "push", "--quiet", "origin", "HEAD:main");
  config = path.join(scratch, "config.json");
  writeConfig();

  // The two baseline suites, each by one command, pushing their own records.
  runs.blueprintBaseline = await evalRun("blueprint baseline", ["perf", "baseline", "blueprint-loop"]);
  runs.narrationBaseline = await evalRun("narration baseline", ["perf", "baseline", "narration-loop"]);
  pushedByBaselines = remoteRecords();

  // The five run commands outside any suite.
  runs.generate = await evalRun("generate", ["generate", `${BRIEFS}/dog-show-rosette.brief.json`, "--judge", "--repair", "2", "--model-override", "generator-agent=opus", "--model-override", "blueprint-judge=opus", "--label", "one brief", "--quiet"]);
  runs.judgeBlueprint = await evalRun("judge blueprint", ["judge", "blueprint", JUDGED_CASE, "--quiet"]);
  runs.serverTurn = await evalRun("server turn", ["judge", "turn", TURN_CASES, "--narrator", "server", "--ai-profile", "mock", "--judges", "flesch"]);
  runs.play = await evalRun("play", ["play", "--blueprint", "mock-case", "--narrator", "mock", "--judge"]);

  // Two runs as result versions 1 and 2 left them, as today's history holds.
  runs.history = [writeAsVersion(runs.judgeBlueprint[0], 1, "2026-11-19/10-00-00-judge-blueprint"), writeAsVersion(runs.judgeBlueprint[0], 2, "2026-11-20/10-00-00-judge-blueprint")];

  await evalRun("push", ["perf", "push"]);
  await evalRun("sync", ["perf", "sync"]);
  await evalRun("report", ["perf", "report"]);
}, 600_000);

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("every command ran", () => {
  it("each exited as its stubs decide, and none broke: the content-free stub narration fails the narration cases' expectations, and the rest passed", () => {
    for (const [step, { code, out, err }] of Object.entries(printed)) expect(code, `${step}:\n${out}\n${err}`).toBe(step === "narration baseline" ? 2 : 0);
    for (const [name, folders] of Object.entries(runs)) expect(folders.length, name).toBeGreaterThan(0);
    expect(runs.blueprintBaseline).toHaveLength(BLUEPRINT_SUITE.runs.length);
    expect(runs.narrationBaseline).toHaveLength(NARRATION_SUITE.runs.length);
    for (const record of recordsOf(allRunFolders())) {
      expect(record.subjects.filter((subject) => subject.run_error_stage !== null), record.run.id).toEqual([]);
    }
  });
});

describe("a run's result names what it evaluated", () => {
  it("its suite and label, developer and host, parent run, each model, each judge's version, and the narrator and generator prompt versions", async () => {
    const [baseline] = await resultsOf(runs.blueprintBaseline[0]);
    expect(baseline.run).toMatchObject({ suite: "blueprint-loop", label: null, developer: "ada", host: os.hostname(), parent_run: null });
    expect(baseline.run.bindings["generator-agent"].model).toBe("opus");
    expect(baseline.run.bindings["blueprint-judge"].model).toBe("opus");
    expect(baseline.run.judge_versions.cg_soundness).toEqual(expect.any(Number));
    expect(baseline.run.prompt_versions).toEqual({ narrator: expect.stringMatching(/^[0-9a-f]{12}$/), generator: expect.stringMatching(/^[0-9a-f]{12}$/) });

    const [adHoc] = await resultsOf(runs.generate[0]);
    expect(adHoc.run).toMatchObject({ suite: null, label: "one brief" });
    expect(adHoc.run.prompt_versions).toEqual(baseline.run.prompt_versions);

    const [turn] = await resultsOf(runs.narrationBaseline[0]);
    expect(turn.run.bindings["narrator-claude"].model).toBe("haiku");
    expect(turn.run.bindings["turn-judge"].model).toBe("sonnet");

    // `judge game`, started by `play --judge`, names the play run as its parent.
    const [game] = await resultsOf(runs.play[0]);
    const judged = fs.readdirSync(runs.play[0], { recursive: true, encoding: "utf8" }).filter((file) => file.includes(`${path.sep}judge${path.sep}`) && file.endsWith("result.json"));
    expect(judged).toHaveLength(1);
    const grading = await readResult(path.join(runs.play[0], judged[0]));
    expect(grading.run).toMatchObject({ command: "judge game", parent_run: game.run.id });
    expect(Object.keys(grading.run.judge_versions)).toEqual(expect.arrayContaining(["gm_roleplay", "gm_spoiler"]));
  });
});

describe("every model call records its tokens beside its duration and cost", () => {
  it("for generator, judge, narrator (a binding, and the server) and investigator calls", async () => {
    const [blueprint] = await resultsOf(runs.blueprintBaseline[0]);
    const generator = blueprint.rounds?.[0]?.call ?? blueprint.production?.calls[0];
    const blueprintJudge = blueprint.verdicts.find((verdict) => verdict.call)?.call;
    const [turn] = (await resultsOf(runs.narrationBaseline[0])).filter((result) => result.production?.calls.length);
    const [game] = await resultsOf(runs.play[0]);
    const investigator = game.production?.calls.find((call) => call.binding === "investigator");
    for (const [role, call] of Object.entries({ generator, blueprintJudge, narrator: turn.production?.calls[0], investigator })) {
      expect(call, role).toMatchObject({ duration_ms: expect.any(Number), cost_usd: expect.any(Number), tokens: TOKENS });
      expect(call?.attempts[0], role).toMatchObject({ cost_usd: expect.any(Number), tokens: TOKENS });
    }
    // The server narrator's calls come from the game's call log; the mock reports no usage, so its tokens and cost are null.
    const [served] = await resultsOf(runs.serverTurn[0]);
    expect(served.production?.calls[0]).toMatchObject({ binding: "server", duration_ms: expect.any(Number), cost_usd: null, tokens: null });
    expect(game.production?.calls.filter((call) => call.binding === "server").length).toBeGreaterThan(0);
  });
});

describe("a finished run writes one immutable record", () => {
  it("with its run, subjects, calls and verdicts", async () => {
    for (const folder of allRunFolders()) {
      const record = readRecord(folder);
      const results = await resultsOf(folder);
      expect(record.run.id, folder).toBe(results[0].run.id);
      expect(record.subjects.map((subject) => subject.id)).toEqual(results.map((result) => result.subject.id));
      expect(record.calls.length, folder).toBeGreaterThan(0);
      expect(record.comparable, folder).toBe(true);
    }
    const [blueprint] = recordsOf(runs.blueprintBaseline);
    expect(blueprint.subjects).toHaveLength(BLUEPRINT_SUITE.runs[0].inputs.length);
    expect(new Set(blueprint.calls.map((call) => call.role))).toEqual(new Set(["generator", "judge"]));
    expect(blueprint.verdicts.some((verdict) => verdict.tier === "judge" && verdict.judge_version !== null)).toBe(true);
    const [play] = recordsOf(runs.play);
    expect(new Set(play.calls.map((call) => call.role))).toEqual(new Set(["investigator", "narrator", "judge"]));
  });

  it("holding none of its prompt, answer or log text", () => {
    for (const folder of allRunFolders()) {
      const record = fs.readFileSync(path.join(folder, RECORD_FILE), "utf8");
      // The stubs' fixed narration, investigator lines and verdict reasoning are answers.
      for (const text of ["Nothing new catches your eye", "search the pantry shelf", "All narration grounded", "Stub verdict", "Sound."]) expect(record, folder).not.toContain(text);
      // Each call's logs hold its prompt, message and raw answer, and the game's call log the server narrator's: no stretch of any of them is in the record.
      const logs = fs.readdirSync(folder, { recursive: true, encoding: "utf8" }).filter((file) => /\.(system|user)\.txt$|\.stdout\.log$|ai-calls[^/]*\.jsonl$/.test(file));
      expect(logs.length, folder).toBeGreaterThan(0);
      for (const log of logs) {
        const text = fs.readFileSync(path.join(folder, log), "utf8");
        for (let at = 0; at + 60 <= text.length; at += 997) expect(record, log).not.toContain(text.slice(at, at + 60));
      }
    }
  });

  it("which nothing rewrites: a second write is refused, and push, sync and report leave each as its run wrote it", () => {
    const pushed = new Map(remoteRecords().map((file) => [file, git(remote, "show", `main:${file}`)]));
    expect(written.size).toBe(allRunFolders().length);
    for (const [folder, content] of written) {
      expect(fs.readFileSync(path.join(folder, RECORD_FILE), "utf8"), folder).toBe(content);
      const record = readRecord(folder);
      if (pushed.has(recordPath(record))) expect(pushed.get(recordPath(record)), folder).toBe(content);
      expect(() => writeRecord(folder, record), folder).toThrow(/EEXIST/);
    }
  });
});

describe("perf push commits unpublished records, one file per run", () => {
  it("a baseline run pushes its own when it ends", () => {
    expect(pushedByBaselines).toHaveLength(BASELINE_RUNS);
    for (const folder of [...runs.blueprintBaseline, ...runs.narrationBaseline]) {
      expect(pushedByBaselines).toContain(recordPath(readRecord(folder)));
    }
  });

  it("then sends every record not yet sent, never one twice, and none that called only stubs", () => {
    const sent = remoteRecords();
    expect(new Set(sent).size).toBe(sent.length);
    // The baselines' three, generate, judge blueprint and play; the server turn called only the mock.
    expect(sent).toHaveLength(RECORDS);
    expect(sent).toEqual(expect.arrayContaining(pushedByBaselines));
    for (const folder of [...runs.generate, ...runs.judgeBlueprint, ...runs.play]) expect(sent, folder).toContain(recordPath(readRecord(folder)));
    expect(sent).not.toContain(recordPath(readRecord(runs.serverTurn[0])));
    expect(printed.push.out).toContain(`3 sent, ${BASELINE_RUNS} already in the data repository, 1 stub-only skipped`);
    // The two history runs predate records, and stay local.
    expect(printed.push.out).toContain("2 run folder(s) have no record.json and stay local");
  });
});

describe("perf sync builds perf.db from run folders and fetched records", () => {
  it("indexes every run once, the shared ones from the data repository, and version 1 and 2 history with the new fields empty", () => {
    const rows = indexRows();
    expect(rows.runs).toHaveLength(allRunFolders().length + runs.history.length);
    expect(printed.sync.out).toContain(`indexed ${rows.runs.length} run(s) (3 local, 0 shared, ${RECORDS} in both)`);
    expect(printed.sync.err).toBe("");
    const history = rows.runs.map((row) => JSON.parse(row)).filter((row) => row.result_version !== "mystery-eval-result/3");
    expect(history.map((row) => [row.run_id, row.result_version]).sort()).toEqual([
      ["2026-11-19/10-00-00-judge-blueprint", "mystery-eval-result/1"],
      ["2026-11-20/10-00-00-judge-blueprint", "mystery-eval-result/2"],
    ]);
    for (const row of history) expect(row).toMatchObject({ developer: "ada", suite: null, label: null, parent_run: null, narrator_prompt: null, attributes: null });
  });

  it("gives the same rows when perf.db is deleted and synced again", async () => {
    const before = indexRows();
    fs.rmSync(path.join(outputRoot, INDEX_FILE));
    await evalRun("sync again", ["perf", "sync"]);
    expect(printed["sync again"].code).toBe(0);
    expect(indexRows()).toEqual(before);
  });

  it("indexes the fetched records when the run folders are gone", async () => {
    const elsewhere = path.join(scratch, "another-machine");
    fs.mkdirSync(elsewhere);
    const out: string[] = [];
    const code = await runEval(["perf", "sync", "--config", config, "--output-root", elsewhere], { root: ROOT, out: (t) => out.push(t), err: () => {}, env: process.env }, COMMAND_SET);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain(`indexed ${RECORDS} run(s) (0 local, ${RECORDS} shared, 0 in both)`);
  });
});

describe("perf report prints per-loop trends and writes the static HTML page", () => {
  it("with cost, time and tokens per call by role and model, and pass rates by judge and prompt version", () => {
    const text = printed.report.out;
    expect(text).toMatch(/^blueprint loop: \d+ run\(s\)/m);
    expect(text).toMatch(/^narration loop: \d+ run\(s\)/m);
    for (const [role, model] of [["generator", "opus"], ["judge", "opus"], ["narrator", "haiku"], ["judge", "sonnet"], ["investigator", "local-investigator"]]) {
      expect(text).toMatch(new RegExp(`${role}\\s+${model}`));
    }
    const report = readReport(outputRoot, { loop: null, suite: null, since: null, match: ATTRIBUTE_NAMES });
    const steps = report.loops.flatMap((loop) => loop.lines.flatMap((line) => line.steps));
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(step.version.prompt).toMatch(/^[0-9a-f]{12}$/);
      for (const stats of step.perRoleModel) {
        // The game's mock narrator reports no usage; every stub behind the usage wrapper reports the same counts.
        const reported = stats.model.startsWith("mock") ? { medianCostUsd: null, medianTokens: null } : { medianCostUsd: expect.any(Number), medianTokens: TOKENS_ADDED };
        expect(stats, `${stats.role} ${stats.model}`).toMatchObject({ medianDurationMs: expect.any(Number), ...reported });
      }
    }
    expect(steps.flatMap((step) => step.judges).some((judge) => judge.judge === "cg_soundness" && judge.version !== null && judge.pass > 0)).toBe(true);

    expect(text).toMatch(/judge pass rates: [^\n]*cg_soundness v\d+ 100%/);
    expect(text).toMatch(new RegExp(`judge\\s+opus\\s+\\d+\\s+\\S+\\s+\\$\\S+\\s+${TOKENS_ADDED}`));

    const html = fs.readFileSync(path.join(outputRoot, REPORT_DIR, REPORT_FILE), "utf8");
    expect(html).toContain("blueprint-loop");
    expect(html).toContain("narration-loop");
    // Per line: the medians table by role and model, the judge pass rates by version, and a chart of each measure.
    expect(html).toContain("<h4>Per call by role and model");
    expect(html).toMatch(new RegExp(`<td>judge</td><td>opus</td>(<td[^>]*>[^<]*</td>){3}<td class="n">${TOKENS_ADDED}</td>`));
    expect(html).toContain("<h4>Judge pass rates</h4>");
    expect(html).toMatch(/<td>cg_soundness<\/td><td>v\d+<\/td><td class="n">100%<\/td>/);
    for (const chart of ["Pass rate per run", "Median duration per call, by role and model", "Median cost per call, by role and model", "Median tokens per call, by role and model"]) {
      expect(html, chart).toContain(chart);
    }
    expect(html).toContain("<svg");
    // One self-contained file: nothing is fetched.
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=|url\(\s*["']?https?:/i);
  });
});

describe("each loop's baseline suite runs by one command, and the report compares runs on the attributes chosen", () => {
  it("every run records its suite attributes", () => {
    for (const record of recordsOf(allRunFolders())) {
      expect(record.run.attributes, record.run.id).not.toBeNull();
      expect(record.run.attributes?.command).toBe(record.run.command);
    }
    const [blueprint] = recordsOf(runs.blueprintBaseline);
    expect(blueprint.run.attributes).toMatchObject({ suite: "blueprint-loop", models: { generator: ["generator-agent:opus"], judge: ["blueprint-judge:opus"] } });
    expect(blueprint.run.attributes?.inputs).toHaveLength(3);
    for (const record of recordsOf(runs.narrationBaseline)) {
      expect(record.run.attributes).toMatchObject({ suite: "narration-loop", samples: 5, concurrency: 4, models: { narrator: ["narrator-claude:haiku"] } });
    }
  });

  it("runs equal on every attribute share a line; matched on fewer, runs that differ elsewhere join it", () => {
    const narration = (match: readonly AttributeName[]) => readReport(outputRoot, { loop: "narration", suite: "narration-loop", since: null, match }).loops[0];
    // The two case folders differ in their inputs: on every attribute, a line each.
    expect(narration(ATTRIBUTE_NAMES).lines.map((line) => line.runs.length)).toEqual([1, 1]);
    const matched = narration(["command", "models", "samples", "concurrency"]);
    expect(matched.lines).toHaveLength(1);
    expect(matched.lines[0].runs).toHaveLength(2);
    expect(matched.lines[0].held.map((held) => held.name)).toEqual(["command", "models", "samples", "concurrency"]);
    expect(matched.lines[0].free).toEqual(expect.arrayContaining(["inputs", "suite"]));

    // The ad-hoc generate shares the baseline's command, options, judges and models, not its inputs or suite.
    const blueprint = (match: readonly AttributeName[]) => readReport(outputRoot, { loop: "blueprint", suite: null, since: null, match }).loops[0];
    const generated = (lines: ReturnType<typeof blueprint>["lines"]) => lines.filter((line) => line.runs.some((run) => run.command === "generate"));
    expect(generated(blueprint(ATTRIBUTE_NAMES).lines).map((line) => line.runs.length)).toEqual([1, 1]);
    expect(generated(blueprint(["command", "options", "judges", "models"]).lines).map((line) => line.runs.length)).toEqual([2]);
  });

  it("perf report --match states above each line what it holds fixed", async () => {
    await evalRun("report matched", ["perf", "report", "--loop", "narration", "--suite", "narration-loop", "--match", "command,models,samples,concurrency"]);
    const { code, out } = printed["report matched"];
    expect(code).toBe(0);
    expect(out).toContain("1 trend line(s), 0 run(s) shown apart");
    expect(out).toMatch(/line 1: 2 run\(s\)[^\n]*\n\s+holds fixed:\n\s+command: judge turn\n\s+models: [^\n]*narrator-claude:haiku/);
  });
});
