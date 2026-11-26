// `./dev eval judge game`, in-process, on a stub binding: no model is called and
// no database but the test's own is opened. The stub is trace-mock-judge.mjs,
// which answers every judge as MOCK_JUDGE_MODE says.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { readRunIndex } from "../../../evaluation/core/run-folder.ts";
import { readResult } from "../../../evaluation/core/result.ts";
import type { Result } from "../../../evaluation/core/result.ts";
import { contentHash } from "../../../evaluation/core/suite-attributes.ts";
import { locateSubject, traceContent } from "../../../evaluation/trace/judge-game.ts";
import { openDatabase } from "../../../packages/game-engine/src/db/client.ts";
import { createGameDatabase, REQUEST_ID } from "./trace-database-fixture.ts";
import { makeRawTrace } from "./trace-fixtures.ts";

const MOCK_JUDGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "trace-mock-judge.mjs");
const GM_JUDGES = ["gm_roleplay", "gm_clue_discipline", "gm_fabrication", "gm_spoiler"];

let scratch = "";
let output: string[] = [];
let errors: string[] = [];

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "trace-judge-game-"));
  output = [];
  errors = [];
  vi.stubEnv("EVAL_HEARTBEAT_MS", "60000");
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(scratch, { recursive: true, force: true });
});

function writeConfig(bindings: Record<string, unknown> | null = {}): string {
  const file = path.join(scratch, "config.json");
  const judge = {
    cmd: process.execPath,
    args: [MOCK_JUDGE, "{{system_prompt_file}}", "{{user_message_file}}"],
    extract_path: "result",
    timeout_ms: 30_000,
    retries: 0,
  };
  fs.writeFileSync(file, JSON.stringify(bindings ?? { "game-judge": judge }));
  return file;
}

const withJudge = () => writeConfig(null);

function writeTrace(trace: unknown = makeRawTrace()): string {
  const file = path.join(scratch, "trace-under-test.json");
  fs.writeFileSync(file, JSON.stringify(trace));
  return file;
}

async function judgeGame(args: string[], root = process.cwd()): Promise<number> {
  return runEval(["judge", "game", ...args], { root, out: (t) => output.push(t), err: (t) => errors.push(t), env: { ...process.env } }, COMMANDS);
}

function resultsUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...resultsUnder(full));
    else if (entry.name === "result.json") found.push(full);
  }
  return found;
}

/** Runs the command and reads back the one result it wrote under its own output root. */
async function runForResult(args: string[], mode: string, root?: string): Promise<{ code: number; result: Result; file: string }> {
  vi.stubEnv("MOCK_JUDGE_MODE", mode);
  const out = path.join(scratch, `out-${fs.readdirSync(scratch).length}`);
  const code = await judgeGame([...args, "--output-root", out, "--quiet"], root);
  const [file] = resultsUnder(out);
  return { code, result: await readResult(file), file };
}

/** Runs a batch and reads back its parent run: the exit code, the index and each game's result. */
async function runBatch(args: string[], mode: string, root: string) {
  vi.stubEnv("MOCK_JUDGE_MODE", mode);
  const out = path.join(scratch, `out-${fs.readdirSync(scratch).length}`);
  const code = await judgeGame([...args, "--output-root", out, "--quiet"], root);
  return { code, ...(await readBatch(out)) };
}

const statuses = (result: Result) => Object.fromEntries(result.verdicts.map((verdict) => [verdict.id, verdict.status]));

describe("judge game on a trace file", () => {
  it("passes: a valid result, the checks and the four judges, exit 0", async () => {
    const { code, result, file } = await runForResult([writeTrace(), "--config", withJudge()], "pass");

    expect(code).toBe(0);
    expect(result.run.command).toBe("judge game");
    expect(result.subject).toEqual({ kind: "game", id: makeRawTrace().session.id, path: "trace.json" });
    expect(statuses(result)).toEqual({
      clue_accounting: "pass",
      spoiler_leak: "pass",
      ...Object.fromEntries(GM_JUDGES.map((id) => [id, "pass"])),
    });
    expect(result.summary.passed).toBe(true);
    expect(result.run_error).toBeNull();
    const judge = result.verdicts.find((verdict) => verdict.id === "gm_fabrication");
    expect(judge?.tier).toBe("judge");
    expect(judge?.call?.binding).toBe("game-judge");
    expect(judge?.call?.prompt_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(result.run.bindings)).toEqual(["game-judge"]);

    const folder = path.dirname(file);
    expect(JSON.parse(fs.readFileSync(path.join(folder, "trace.json"), "utf8"))).toEqual(makeRawTrace());
    expect(fs.existsSync(path.join(folder, "reconstruction.json"))).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(folder), "run.json"))).toBe(true);
  });

  it("records the suite, label and parent run it was given, with who ran it and where", async () => {
    const parent = "2026-11-25/10-00-00-play";
    const { result } = await runForResult(
      [writeTrace(), "--config", withJudge(), "--suite", "narration-loop", "--label", "graded", "--parent-run", parent],
      "pass",
    );
    expect(result.run).toMatchObject({ suite: "narration-loop", label: "graded", parent_run: parent, host: os.hostname() });
    expect(result.run.developer).toEqual(expect.any(String));
  });

  it("records no parent run when it was given none, and refuses a blank one", async () => {
    const { result } = await runForResult([writeTrace(), "--config", withJudge()], "pass");
    expect(result.run).toMatchObject({ suite: null, label: null, parent_run: null });
    expect(await judgeGame([writeTrace(), "--config", withJudge(), "--parent-run", " "])).toBe(1);
    expect(errors.join("\n")).toContain("--parent-run needs a run id");
  });

  it("exits 2 when a judge reports a major finding", async () => {
    const { code, result } = await runForResult([writeTrace(), "--config", withJudge()], "fail");

    expect(code).toBe(2);
    expect(statuses(result).gm_fabrication).toBe("fail");
    expect(result.summary.passed).toBe(false);
    expect(result.run_error).toBeNull();
  });

  it("exits 2 when a judge's answer cannot be used, saying why", async () => {
    const { code, result } = await runForResult([writeTrace(), "--config", withJudge()], "invalid");

    expect(code).toBe(2);
    const verdict = result.verdicts.find((entry) => entry.id === "gm_roleplay");
    expect(verdict?.status).toBe("error");
    expect(verdict?.reason).toMatch(/schema validation/);
    expect(verdict?.call?.attempts[0].outcome).toBe("invalid");
  });

  it("exits 2 when the judge command crashes", async () => {
    const { code, result } = await runForResult([writeTrace(), "--config", withJudge()], "crash");

    expect(code).toBe(2);
    expect(statuses(result).gm_spoiler).toBe("error");
    expect(result.verdicts.find((entry) => entry.id === "gm_spoiler")?.call?.attempts[0].outcome).toBe("exit");
  });

  it("exits 2 when a mechanical check fails, whatever the judges say", async () => {
    const trace = makeRawTrace();
    trace.events[1].payload = { ...trace.events[1].payload, revealed_clue_id: "clue_that_does_not_exist" };
    const { code, result } = await runForResult([writeTrace(trace), "--config", withJudge()], "pass");

    expect(code).toBe(2);
    expect(statuses(result).clue_accounting).toBe("fail");
  });

  it("exits 1 and still writes a result when the trace cannot be read", async () => {
    const broken = path.join(scratch, "broken.json");
    fs.writeFileSync(broken, '{"schema_version": "trace/0.1"}');
    const { code, result } = await runForResult([broken, "--config", withJudge()], "pass");

    expect(code).toBe(1);
    expect(result.run_error?.stage).toBe("load_trace");
    expect(result.run_error?.message).toMatch(/session/);
    expect(result.subject).toEqual({ kind: "game", id: "broken", path: null });
    expect(errors.join("\n")).toMatch(/load_trace|session/);
  });
});

describe("judging a stored trace again", () => {
  it("reaches the same verdicts as the run that stored it", async () => {
    const first = await runForResult([writeTrace(), "--config", withJudge()], "fail");
    const stored = path.join(path.dirname(first.file), "trace.json");

    const second = await runForResult([stored, "--config", withJudge()], "fail");

    const answers = (result: Result) =>
      result.verdicts.map(({ id, tier, status, findings, details, answer }) => ({ id, tier, status, findings, details, answer }));
    expect(second.code).toBe(first.code);
    expect(answers(second.result)).toEqual(answers(first.result));
    expect(second.result.subject).toEqual(first.result.subject);
    expect(second.result.verdicts.map((v) => v.call?.prompt_sha256)).toEqual(first.result.verdicts.map((v) => v.call?.prompt_sha256));
  });
});

describe("the bindings and the judges a run asks for", () => {
  it("is an error when the game judge has no binding, before anything is read or written", async () => {
    const out = path.join(scratch, "out-none");
    vi.stubEnv("MOCK_JUDGE_MODE", "pass");
    const code = await judgeGame([writeTrace(), "--config", writeConfig({}), "--output-root", out]);

    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/no binding "game-judge"/);
    expect(fs.existsSync(out)).toBe(false);
  });

  it("is an error when the game judge's command does not exist", async () => {
    const config = writeConfig({
      "game-judge": { cmd: "no-such-command-anywhere", args: [], extract_path: null, timeout_ms: 1000, retries: 0 },
    });
    const code = await judgeGame([writeTrace(), "--config", config, "--output-root", path.join(scratch, "out")]);

    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/cannot run/);
  });

  it("--no-judges runs the checks alone, needs no binding and skips the judges by name", async () => {
    const { code, result } = await runForResult([writeTrace(), "--config", writeConfig({}), "--no-judges"], "pass");

    expect(code).toBe(0);
    expect(statuses(result)).toMatchObject({
      clue_accounting: "pass",
      ...Object.fromEntries(GM_JUDGES.map((id) => [id, "skipped"])),
    });
    expect(result.verdicts.find((v) => v.id === "gm_spoiler")?.reason).toBe("--no-judges");
    expect(result.run.bindings).toEqual({});
  });

  it("--judges runs the named judges and skips the others", async () => {
    const { code, result } = await runForResult([writeTrace(), "--config", withJudge(), "--judges", "gm_spoiler,gm_roleplay"], "pass");

    expect(code).toBe(0);
    expect(statuses(result)).toMatchObject({
      gm_roleplay: "pass",
      gm_spoiler: "pass",
      gm_fabrication: "skipped",
      gm_clue_discipline: "skipped",
    });
  });

  it("refuses a judge it does not know, and --judges with --no-judges", async () => {
    expect(await judgeGame([writeTrace(), "--config", withJudge(), "--judges", "gm_nope"])).toBe(1);
    expect(errors.join("\n")).toMatch(/gm_roleplay.*\(not: gm_nope\)/);
    errors = [];
    expect(await judgeGame([writeTrace(), "--config", withJudge(), "--judges", "gm_spoiler", "--no-judges"])).toBe(1);
    expect(errors.join("\n")).toMatch(/contradict/);
  });

  it("--model-override changes the model the run records", async () => {
    const { result } = await runForResult([writeTrace(), "--config", withJudge(), "--model-override", "game-judge=haiku"], "pass");

    expect(result.run.bindings["game-judge"].model).toBe("haiku");
    expect(result.verdicts.find((v) => v.id === "gm_spoiler")?.call?.model).toBe("haiku");
  });
});

describe("judge game's suite attributes", () => {
  it("records the trace's hash, the judges and the judge's model", async () => {
    const trace = makeRawTrace();
    const { result } = await runForResult([writeTrace(trace), "--config", withJudge(), "--suite", "narration-loop"], "pass");
    const attributes = result.run.attributes;
    expect(attributes).toEqual({
      command: "judge game",
      options: {},
      inputs: [{ id: trace.session.id, hash: contentHash(traceContent(trace)) }],
      judges: [...GM_JUDGES].sort(),
      models: { generator: null, narrator: null, investigator: null, judge: ["game-judge"] },
      samples: null,
      concurrency: null,
      suite: "narration-loop",
    });

    // The same game extracted again elsewhere, judged with output and naming options added: the same attributes.
    const again = makeRawTrace({ extracted_at: "2026-06-03T00:00:00Z", source: { kind: "local", database: "/elsewhere/game.db" } });
    const rerun = await runForResult([writeTrace(again), "--config", withJudge(), "--suite", "narration-loop", "--label", "again", "--parent-run", "2026-11-25/10-00-00-play"], "pass");
    expect(rerun.result.run.attributes).toEqual(attributes);

    // An edited game changes the hash; a model override shows in the judge's models.
    const edited = makeRawTrace({ events: makeRawTrace().events.slice(1) });
    const changed = await runForResult([writeTrace(edited), "--config", withJudge(), "--suite", "narration-loop", "--model-override", "game-judge=haiku"], "pass");
    expect(changed.result.run.attributes).toEqual({
      ...attributes,
      inputs: [{ id: trace.session.id, hash: contentHash(traceContent(edited)) }],
      models: { ...attributes?.models, judge: ["game-judge:haiku"] },
    });
    expect(contentHash(traceContent(edited))).not.toBe(contentHash(traceContent(trace)));
  });

  it("records the judges --judges names, none with --no-judges, and no hash for a trace it cannot read", async () => {
    const named = await runForResult([writeTrace(), "--config", withJudge(), "--judges", "gm_spoiler,gm_roleplay"], "pass");
    expect(named.result.run.attributes).toMatchObject({ judges: ["gm_roleplay", "gm_spoiler"] });
    const none = await runForResult([writeTrace(), "--no-judges"], "pass");
    expect(none.result.run.attributes).toMatchObject({ judges: [], models: { judge: null } });

    const broken = path.join(scratch, "broken.json");
    fs.writeFileSync(broken, '{"schema_version": "trace/0.1"}');
    const unread = await runForResult([broken, "--config", withJudge()], "pass");
    expect(unread.result.run.attributes?.inputs).toEqual([{ id: "broken", hash: null }]);
  });
});

describe("judge game on a session id", () => {
  it("extracts the game read-only, stores its trace beside the result and judges it", async () => {
    const game = createGameDatabase(path.join(scratch, "play"));
    const before = fs.readFileSync(game.databasePath);

    const { code, result, file } = await runForResult(
      [game.sessionId, "--database", game.databasePath, "--config", withJudge()],
      "pass",
      game.root,
    );

    expect(code).toBe(0);
    expect(result.subject).toEqual({ kind: "game", id: game.sessionId, path: "trace.json" });
    const stored = JSON.parse(fs.readFileSync(path.join(path.dirname(file), "trace.json"), "utf8"));
    expect(stored.session.id).toBe(game.sessionId);
    expect(stored.source.database).toBe(path.resolve(game.databasePath));
    expect(result.timing?.stages.map((stage) => stage.name)).toEqual(["extract", "reconstruct", "mechanical", "judges"]);
    expect(fs.readFileSync(game.databasePath).equals(before)).toBe(true);
  });

  it("exits 1, with a result, when the session is not in the database", async () => {
    const game = createGameDatabase(path.join(scratch, "play"));

    const { code, result } = await runForResult(
      ["no-such-session", "--database", game.databasePath, "--config", withJudge()],
      "pass",
      game.root,
    );

    expect(code).toBe(1);
    expect(result.run_error).toMatchObject({ stage: "extract" });
    expect(result.run_error?.message).toMatch(/not found/);
    expect(result.subject).toEqual({ kind: "game", id: "no-such-session", path: null });
  });

  it("exits 1 when the database file does not exist, creating nothing", async () => {
    const missing = path.join(scratch, "nowhere", "game.db");
    const { code, result } = await runForResult(["a-session", "--database", missing, "--config", withJudge()], "pass", scratch);

    expect(code).toBe(1);
    expect(result.run_error?.message).toMatch(/no game database/);
    expect(fs.existsSync(path.dirname(missing))).toBe(false);
  });

  it("refuses --database with a trace file", async () => {
    const code = await judgeGame([writeTrace(), "--database", "x.db", "--config", withJudge()]);

    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/needs no database/);
  });
});

/** A copy of the fixture's game as another session, started at `startedAt`, whose search was made by its own request. */
function addGame(databasePath: string, id: string, startedAt: string): string {
  const db = openDatabase({ path: databasePath });
  try {
    const session = db.prepare("select * from game_sessions where id = 'session-under-test'").get() as Record<string, unknown>;
    const events = db.prepare("select * from game_events where session_id = 'session-under-test'").all() as Array<Record<string, unknown>>;
    const insert = (table: string, row: Record<string, unknown>) =>
      db.prepare(`insert into ${table} (${Object.keys(row).join(", ")}) values (${Object.keys(row).map(() => "?").join(", ")})`).run(...(Object.values(row) as Array<string | number | null>));
    insert("game_sessions", { ...session, id, created_at: startedAt });
    for (const event of events) {
      const requestId = event.request_id === null ? null : `${event.request_id}-${id}`;
      insert("game_events", { ...event, id: `${id}-${event.id}`, session_id: id, request_id: requestId });
    }
  } finally {
    db.close();
  }
  return `${REQUEST_ID}-${id}`;
}

function callLine(over: Record<string, unknown>): string {
  return `${JSON.stringify({
    ts: "2026-06-02T00:00:00.000Z",
    game_id: "session-under-test",
    endpoint: "game-turn",
    action: "search",
    request_id: null,
    role: "ask",
    provider: "claude-cli",
    model: "haiku",
    resolved_model: "claude-haiku-4-5",
    prompt: "TELL THE STORY",
    context: null,
    output: { narration: "x" },
    parsed_ok: true,
    error: null,
    latency_ms: 1200,
    input_tokens: 100,
    output_tokens: 10,
    cost_usd: 0.002,
    attempts: 1,
    ...over,
  })}\n`;
}

/** A playtest bundle: two games in `game.db` and a call log with a line for each game's search and one with no request. */
function makeBundle(): { folder: string; ids: string[] } {
  const folder = path.join(scratch, "bundle");
  const game = createGameDatabase(folder);
  const second = addGame(game.databasePath, "second-session", "2026-06-03T00:00:00Z");
  fs.writeFileSync(
    path.join(folder, "ai-calls.jsonl"),
    callLine({ request_id: REQUEST_ID, latency_ms: 111 }) +
      callLine({ request_id: second, game_id: "second-session", latency_ms: 222 }) +
      callLine({ request_id: second, game_id: "second-session", latency_ms: 333 }) +
      callLine({ request_id: null, latency_ms: 444 }),
  );
  return { folder, ids: [game.sessionId, "second-session"] };
}

/** The run a batch wrote: its index, and each game's result by id. */
async function readBatch(out: string): Promise<{ run: ReturnType<typeof readRunIndex>; dir: string; results: Record<string, Result> }> {
  const [day] = fs.readdirSync(out);
  const [name] = fs.readdirSync(path.join(out, day));
  const dir = path.join(out, day, name);
  const run = readRunIndex(dir);
  const results = Object.fromEntries(
    await Promise.all(run.subjects.map(async (subject) => [subject.id, await readResult(path.join(dir, subject.dir, "result.json"))] as const)),
  );
  return { run, dir, results };
}

describe("judge game on a batch", () => {
  it("judges several ids, writing one parent run and a child run per game", async () => {
    const bundle = makeBundle();
    vi.stubEnv("MOCK_JUDGE_MODE", "pass");
    const out = path.join(scratch, "out-batch");
    const code = await judgeGame(
      [...bundle.ids, "--database", path.join(bundle.folder, "game.db"), "--config", withJudge(), "--suite", "narration-loop", "--output-root", out, "--quiet"],
      bundle.folder,
    );

    expect(code).toBe(0);
    const { run, dir, results } = await readBatch(out);
    expect(run.subjects.map((subject) => subject.id).sort()).toEqual([...bundle.ids].sort());
    expect(run.exit_code).toBe(0);
    for (const id of bundle.ids) {
      const result = results[id];
      expect(result.run).toMatchObject({ command: "judge game", parent_run: null, suite: "narration-loop" });
      expect(result.subject).toEqual({ kind: "game", id, path: "trace.json" });
      expect(statuses(result)).toMatchObject({ clue_accounting: "pass", gm_spoiler: "pass" });
      expect(result.summary.passed).toBe(true);
      // The child is the run a single game writes: its own folder, naming the batch as its parent.
      const subjectDir = path.join(dir, run.subjects.find((subject) => subject.id === id)!.dir);
      const [childFile] = resultsUnder(path.join(subjectDir, "judge"));
      const child = await readResult(childFile);
      expect(child.run).toMatchObject({ command: "judge game", parent_run: run.run.id, suite: "narration-loop" });
      expect(child.verdicts).toEqual(result.verdicts);
      expect(fs.existsSync(path.join(path.dirname(childFile), "reconstruction.json"))).toBe(true);
    }
    expect(run.run.attributes).toMatchObject({ command: "judge game", concurrency: 2, inputs: [{ id: expect.any(String) }, { id: expect.any(String) }] });
  });

  it("judges every game in a bundle and attaches each game's calls, joined by request_id", async () => {
    const bundle = makeBundle();
    const { code, ...batch } = await runBatch(["--bundle", bundle.folder, "--config", withJudge()], "pass", scratch);

    expect(code).toBe(0);
    expect(Object.keys(batch.results).sort()).toEqual([...bundle.ids].sort());
    const durations = (id: string) => batch.results[id].production?.calls.map((call) => call.duration_ms);
    expect(durations("session-under-test")).toEqual([111]);
    expect(durations("second-session")).toEqual([222, 333]);
    expect(batch.results["second-session"].production?.calls[0]).toMatchObject({
      binding: "server",
      model: "claude-haiku-4-5",
      cost_usd: 0.002,
      tokens: { input: 100, output: 10 },
    });
    // The line with no request is nobody's, and each game keeps only its own lines.
    const kept = fs.readFileSync(path.join(batch.dir, batch.run.subjects.find((s) => s.id === "second-session")!.dir, "ai-calls.jsonl"), "utf8");
    expect(kept.trim().split("\n").map((text) => JSON.parse(text).latency_ms)).toEqual([222, 333]);
  });

  it("takes a bundle without a call log, and attaches no calls", async () => {
    const bundle = makeBundle();
    fs.rmSync(path.join(bundle.folder, "ai-calls.jsonl"));
    const { code, results } = await runBatch(["--bundle", bundle.folder, "--config", withJudge()], "pass", scratch);

    expect(code).toBe(0);
    expect(Object.values(results).map((result) => result.production)).toEqual([null, null]);
  });

  it("with --since and --database, judges only the games started on or after the date", async () => {
    const bundle = makeBundle();
    const database = path.join(bundle.folder, "game.db");

    const later = await runBatch(["--since", "2026-06-03", "--database", database, "--config", withJudge()], "pass", scratch);
    expect(Object.keys(later.results)).toEqual(["second-session"]);
    expect(later.results["second-session"].production).toBeNull();

    const all = await runBatch(["--since", "2026-06-02", "--database", database, "--config", withJudge()], "pass", scratch);
    expect(Object.keys(all.results).sort()).toEqual([...bundle.ids].sort());
  });

  it("writes no run and exits 1 when the selection is empty, saying so", async () => {
    const bundle = makeBundle();
    const out = path.join(scratch, "out-empty");
    vi.stubEnv("MOCK_JUDGE_MODE", "pass");
    const code = await judgeGame(["--since", "2030-01-01", "--database", path.join(bundle.folder, "game.db"), "--config", withJudge(), "--output-root", out], bundle.folder);

    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/no games started on or after 2030-01-01/);
    expect(fs.existsSync(out)).toBe(false);
  });

  it("reports a game that cannot be read and judges the others, exiting 1", async () => {
    const bundle = makeBundle();
    const { code, results, run } = await runBatch([...bundle.ids, "no-such-session", "--database", path.join(bundle.folder, "game.db"), "--config", withJudge()], "pass", bundle.folder);

    expect(code).toBe(1);
    expect(results["no-such-session"].run_error).toMatchObject({ stage: "extract" });
    expect(results["no-such-session"].subject.path).toBeNull();
    expect(results["session-under-test"].summary.passed).toBe(true);
    expect(results["second-session"].summary.passed).toBe(true);
    expect(run.subjects).toHaveLength(3);
    expect(errors.join("\n")).toMatch(/no-such-session\] error/);
  });

  it("reports a game whose judge fails, exiting 2, and keeps judging the rest", async () => {
    const bundle = makeBundle();
    const { code, results } = await runBatch(["--bundle", bundle.folder, "--config", withJudge()], "fail", scratch);

    expect(code).toBe(2);
    expect(Object.values(results).map((result) => statuses(result).gm_fabrication)).toEqual(["fail", "fail"]);
  });

  it("reports a call log it cannot read once, on the result of each game, and still judges them", async () => {
    const bundle = makeBundle();
    fs.writeFileSync(path.join(bundle.folder, "ai-calls.jsonl"), '{"half":\n');
    const { code, results } = await runBatch(["--bundle", bundle.folder, "--config", withJudge()], "pass", scratch);

    expect(code).toBe(1);
    for (const id of bundle.ids) {
      expect(results[id].run_error).toMatchObject({ stage: "model_calls" });
      expect(results[id].run_error?.message).toMatch(/ai-calls\.jsonl line 1 is not JSON/);
      expect(statuses(results[id]).gm_spoiler).toBe("pass");
      expect(errors.filter((text) => text.includes(`[${id}] error`))).toHaveLength(1);
    }
  });

  it("reports judges that all error on every game, exiting 2", async () => {
    const bundle = makeBundle();
    const { code, results } = await runBatch(["--bundle", bundle.folder, "--config", withJudge()], "crash", scratch);

    expect(code).toBe(2);
    for (const id of bundle.ids) expect(statuses(results[id]).gm_spoiler).toBe("error");
  });

  it("judges several trace files, and a single id still writes no parent", async () => {
    const first = writeTrace();
    const second = path.join(scratch, "second-trace.json");
    fs.writeFileSync(second, JSON.stringify(makeRawTrace({ session: { ...makeRawTrace().session, id: "other-game" } })));
    const { code, results } = await runBatch([first, second, "--config", withJudge()], "pass", scratch);

    expect(code).toBe(0);
    expect(Object.keys(results).sort()).toEqual([makeRawTrace().session.id, "other-game"].sort());

    const single = await runForResult([first, "--config", withJudge()], "pass");
    expect(single.result.run.parent_run).toBeNull();
    expect(fs.existsSync(path.join(path.dirname(single.file), "judge"))).toBe(false);
  });

  it.each([
    [["a-session", "--bundle", "x"], /drop the session ids/],
    [["a-session", "b-session", "--since", "2026-06-01"], /drop the session ids/],
    [["--bundle", "x", "--since", "2026-06-01"], /use one/],
    [["--bundle", "x", "--database", "y.db"], /drop --database/],
    [["--since", "yesterday"], /--since needs a date/],
    [["--since", "2026-06-01", "--concurrency", "0"], /--concurrency needs a positive integer/],
    [[], /name a session id or trace file/],
  ])("refuses %j as a usage error", async (args, message) => {
    expect(await judgeGame([...args, "--config", withJudge()])).toBe(1);
    expect(errors.join("\n")).toMatch(message);
  });

  it("refuses a trace file among several ids read with --database", async () => {
    const bundle = makeBundle();
    expect(await judgeGame([writeTrace(), "second-session", "--database", path.join(bundle.folder, "game.db"), "--config", withJudge()])).toBe(1);
    expect(errors.join("\n")).toMatch(/needs no database/);
  });

  it("is an error when the bundle folder holds no game.db", async () => {
    expect(await judgeGame(["--bundle", scratch, "--config", withJudge()])).toBe(1);
    expect(errors.join("\n")).toMatch(/no game\.db in .* not a playtest bundle/);
  });
});

describe("telling a session id from a trace file", () => {
  it("takes an existing file as a trace, whatever it is called", () => {
    const file = path.join(scratch, "no-extension");
    fs.writeFileSync(file, "{}");
    expect(locateSubject(file)).toEqual({ kind: "file", path: file });
  });

  it("takes anything else without a separator or .json as a session id", () => {
    expect(locateSubject("3f9c1e2a-session")).toEqual({ kind: "session", id: "3f9c1e2a-session" });
  });

  it("refuses a path, or a .json name, that is not a file, rather than asking the database for it", () => {
    expect(() => locateSubject(path.join(scratch, "missing", "trace.json"))).toThrow(/no trace file at/);
    expect(() => locateSubject("trace.json")).toThrow(/no trace file at/);
  });
});

describe("--help", () => {
  it("is listed, and prints its own help", async () => {
    expect(await runEval([], { root: process.cwd(), out: (t) => output.push(t), err: () => {}, env: {} }, COMMANDS)).toBe(0);
    expect(output.join("\n")).toMatch(/judge game/);
    output = [];
    expect(await judgeGame(["--help"])).toBe(0);
    expect(output.join("\n")).toMatch(/Usage: .\/dev eval judge game <session id or trace file>/);
  });
});
