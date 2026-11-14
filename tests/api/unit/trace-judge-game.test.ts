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
import { readResult } from "../../../evaluation/core/result.ts";
import type { Result } from "../../../evaluation/core/result.ts";
import { locateSubject } from "../../../evaluation/trace/judge-game.ts";
import { createGameDatabase } from "./trace-database-fixture.ts";
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
