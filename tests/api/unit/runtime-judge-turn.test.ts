// `judge turn` end to end, in process, on stub bindings: a cli stub narrator and
// the judge stub. No model, no server and no database is touched; what is
// checked is what a run writes and what it exits with.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { runEval } from "../../../evaluation/core/dispatch.ts";
import { readResult } from "../../../evaluation/core/result.ts";
import { readRunIndex } from "../../../evaluation/core/run-folder.ts";
import type { Result } from "../../../evaluation/core/result.ts";
import { createJudgeTurnCommand, judgeTurnCommand } from "../../../evaluation/runtime/judge-turn.ts";
import { makeTurn } from "./runtime-turn-helpers.ts";
import { MOCK_CASE_PATH } from "../../testkit/src/mock-case.ts";

const REPO_ROOT = process.cwd();
const CASES = "evaluation/runtime/cases/clue-graph/mock-case/readability.ts";
const STUB_NARRATOR = {
  cmd: "evaluation/runtime/config/wrappers/stub-runtime.sh",
  args: ["{{user_message_file}}"],
  timeout_ms: 30_000,
};
const STUB_JUDGE = {
  cmd: "evaluation/runtime/config/wrappers/stub-judge.sh",
  args: ["{{user_message_file}}"],
  timeout_ms: 30_000,
};

let scratch = "";
let configFile = "";

interface Ran {
  code: number;
  output: string;
  runDir: string;
}

async function run(args: string[], config = configFile, env: Record<string, string> = {}, command = judgeTurnCommand): Promise<Ran> {
  const outputRoot = path.join(scratch, `out-${fs.readdirSync(scratch).length}`);
  const lines: string[] = [];
  // Through the dispatcher, which turns a command that throws into exit code 1 and a message.
  const code = await runEval(["judge", "turn", ...args, "--config", config, "--output-root", outputRoot], {
    root: REPO_ROOT,
    out: (text) => lines.push(text),
    err: (text) => lines.push(text),
    env,
  }, [command]);
  const days = fs.existsSync(outputRoot) ? fs.readdirSync(outputRoot) : [];
  const runDir = days.length > 0 ? path.join(outputRoot, days[0], fs.readdirSync(path.join(outputRoot, days[0]))[0]) : "";
  return { code, output: lines.join("\n"), runDir };
}

function subjectDirs(runDir: string): string[] {
  return fs
    .readdirSync(runDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runDir, entry.name))
    .sort();
}

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-judge-turn-"));
  configFile = path.join(scratch, "config.json");
  fs.writeFileSync(configFile, JSON.stringify({ "narrator-stub": STUB_NARRATOR, "judge-stub": STUB_JUDGE, "turn-judge": STUB_JUDGE }));
});

afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

afterEach(() => {
  delete process.env.RUNTIME_JUDGE_STUB_VERDICT;
});

describe("judge turn over a case set", () => {
  it("writes a valid result and a stored turn for every case, and exits 0 when all pass", async () => {
    const { code, output, runDir } = await run([CASES, "--narrator", "narrator-stub", "--judges", "flesch,age_appropriate_turn", "--judge-binding", "judge-stub"]);
    expect(output).toContain("ask-alice-alibi-pressure__narrator-stub -> flesch:pass");
    expect(code).toBe(0);

    const index = readRunIndex(runDir);
    expect(index.exit_code).toBe(0);
    expect(index.subjects.map((subject) => subject.id).sort()).toEqual([
      "ask-alice-alibi-pressure__narrator-stub",
      "talk-bob-open__narrator-stub",
    ]);
    expect(Object.keys(index.run.bindings).sort()).toEqual(["judge-stub", "narrator-stub"]);

    for (const dir of subjectDirs(runDir)) {
      const result = await readResult(path.join(dir, "result.json"));
      expect(result.subject).toMatchObject({ kind: "turn", path: "turn.json" });
      expect(result.verdicts.map((verdict) => [verdict.id, verdict.tier, verdict.status])).toEqual([
        ["flesch", "mechanical", "pass"],
        ["age_appropriate_turn", "judge", "pass"],
      ]);
      // The narrator's call is the subject's production; a judge's call is its own.
      expect(result.production?.calls.map((call) => call.binding)).toEqual(["narrator-stub"]);
      expect(result.verdicts[1].call?.binding).toBe("judge-stub");
      const turn = JSON.parse(fs.readFileSync(path.join(dir, "turn.json"), "utf8"));
      expect(turn).toMatchObject({ narrator: "narrator-stub", target_age: 10 });
      expect(turn.response.narration_text.length).toBeGreaterThan(0);
    }
  });

  it("records the suite and label it was given, and nulls when it was given none", async () => {
    const args = [CASES, "--narrator", "narrator-stub", "--judges", "flesch"];
    const named = await run([...args, "--suite", "narration-loop", "--label", "five samples"]);
    expect(readRunIndex(named.runDir).run).toMatchObject({ suite: "narration-loop", label: "five samples", host: os.hostname(), parent_run: null });
    const [dir] = subjectDirs(named.runDir);
    expect((await readResult(path.join(dir, "result.json"))).run).toMatchObject({ suite: "narration-loop", label: "five samples" });

    const adHoc = await run(args);
    expect(readRunIndex(adHoc.runDir).run).toMatchObject({ suite: null, label: null });
  });

  it("exits 2 when a judge fails, and 0 for the same run without it", async () => {
    process.env.RUNTIME_JUDGE_STUB_VERDICT = JSON.stringify({ estimated_reading_age: 14, findings: [], verdict: "fail", reasoning: "Too hard." });
    const failing = await run([CASES, "--narrator", "narrator-stub", "--judges", "age_appropriate_turn", "--judge-binding", "judge-stub"]);
    expect(failing.code).toBe(2);
    expect(readRunIndex(failing.runDir).subjects.every((subject) => !subject.summary.passed)).toBe(true);
  });

  it("exits 2 when a judge cannot judge, since that is not a pass", async () => {
    process.env.RUNTIME_JUDGE_STUB_VERDICT = "not json";
    const { code, runDir } = await run([CASES, "--narrator", "narrator-stub", "--judges", "age_appropriate_turn", "--judge-binding", "judge-stub"]);
    expect(code).toBe(2);
    const [dir] = subjectDirs(runDir);
    expect((await readResult(path.join(dir, "result.json"))).verdicts[0].status).toBe("error");
  });

  it("uses the case's own judges when --judges is not given", async () => {
    const { code, runDir } = await run([CASES, "--narrator", "narrator-stub"]);
    expect(code).toBe(0);
    const [dir] = subjectDirs(runDir);
    expect((await readResult(path.join(dir, "result.json"))).verdicts.map((verdict) => verdict.id)).toEqual(["flesch"]);
  });

  it("exits 1 and records a run error when the narrator cannot produce a turn", async () => {
    const broken = path.join(scratch, "broken.json");
    fs.writeFileSync(broken, JSON.stringify({ "narrator-stub": { ...STUB_NARRATOR, cmd: "false", args: [] } }));
    const { code, runDir } = await run([CASES, "--narrator", "narrator-stub"], broken);
    expect(code).toBe(1);
    const [dir] = subjectDirs(runDir);
    const result: Result = await readResult(path.join(dir, "result.json"));
    expect(result.run_error).toMatchObject({ stage: "transport" });
    expect(result.production?.calls[0].attempts[0].outcome).toBe("exit");
    expect(result.subject.path).toBeNull();
    expect(fs.existsSync(path.join(dir, "turn.json"))).toBe(false);
  });

  it("records a model override in the bindings the run used", async () => {
    const { runDir } = await run([CASES, "--narrator", "narrator-stub", "--model-override", "narrator-stub=other-model"]);
    expect(readRunIndex(runDir).run.bindings["narrator-stub"].model).toBe("other-model");
  });
});

describe("judge turn on a stored turn", () => {
  it("judges it again to the same verdicts without calling the narrator", async () => {
    const first = await run([CASES, "--narrator", "narrator-stub", "--judges", "flesch,age_appropriate_turn", "--judge-binding", "judge-stub"]);
    const [dir] = subjectDirs(first.runDir);
    const before = await readResult(path.join(dir, "result.json"));

    // A config whose narrator cannot run: nothing may ask for it.
    const noNarrator = path.join(scratch, "no-narrator.json");
    fs.writeFileSync(noNarrator, JSON.stringify({ "judge-stub": STUB_JUDGE }));
    const again = await run([path.join(dir, "turn.json"), "--judge-binding", "judge-stub"], noNarrator);
    expect(again.code).toBe(0);

    const [againDir] = subjectDirs(again.runDir);
    const after = await readResult(path.join(againDir, "result.json"));
    // The earlier result's judges are the default, and the verdicts are the same.
    const outcome = (result: Result) => result.verdicts.map(({ id, status, details, findings }) => ({ id, status, details, findings }));
    expect(outcome(after)).toEqual(outcome(before));
    expect(after.production).toBeNull();
    expect(after.subject).toMatchObject({ kind: "turn", id: before.subject.id, path: "turn.json" });
    expect(Object.keys(readRunIndex(again.runDir).run.bindings)).toEqual(["judge-stub"]);
    // Stored beside the new result, byte for byte.
    expect(fs.readFileSync(path.join(againDir, "turn.json"), "utf8")).toBe(fs.readFileSync(path.join(dir, "turn.json"), "utf8"));
  });

  it("defaults to flesch when there is no earlier result", async () => {
    const lone = path.join(scratch, "lone-turn.json");
    fs.writeFileSync(lone, JSON.stringify(makeTurn({ blueprint_path: path.resolve(MOCK_CASE_PATH) })));
    const { code, runDir } = await run([lone]);
    expect(code).toBe(0);
    const [dir] = subjectDirs(runDir);
    expect((await readResult(path.join(dir, "result.json"))).verdicts.map((verdict) => verdict.id)).toEqual(["flesch"]);
  });

  it("refuses a file that is not a stored turn or a case", async () => {
    const odd = path.join(scratch, "odd.json");
    fs.writeFileSync(odd, JSON.stringify({ hello: "world" }));
    const { code, output } = await run([odd]);
    expect(code).toBe(1);
    expect(output).toContain("must have");
  });
});

describe("judge turn refuses what it cannot run", () => {
  it("stops, naming the binding, when a narrator binding is missing", async () => {
    const { code, output } = await run([CASES, "--narrator", "narrator-nope"]);
    expect(code).toBe(1);
    expect(output).toContain('no binding "narrator-nope"');
  });

  it("stops when the judge binding cannot run, rather than skipping its judges", async () => {
    const missing = path.join(scratch, "no-judge.json");
    fs.writeFileSync(missing, JSON.stringify({ "narrator-stub": STUB_NARRATOR }));
    const { code, output } = await run([CASES, "--narrator", "narrator-stub", "--judges", "age_appropriate_turn"], missing);
    expect(code).toBe(1);
    expect(output).toContain('no binding "turn-judge"');
  });

  it("needs no judge binding when no model judge is asked for", async () => {
    const onlyNarrator = path.join(scratch, "only-narrator.json");
    fs.writeFileSync(onlyNarrator, JSON.stringify({ "narrator-stub": STUB_NARRATOR }));
    expect((await run([CASES, "--narrator", "narrator-stub", "--judges", "flesch"], onlyNarrator)).code).toBe(0);
  });

  it.each([
    [["--judges", "nope"], "Unknown check or judge"],
    [["--judges", "cg_soundness"], "does not judge a turn"],
    [["--narrator", "claude"], "narrator binding"],
    [["--concurrency", "0"], "positive integer"],
    [["--judges", ","], "at least one"],
  ])("rejects %j as a usage error", async (args, message) => {
    const { code, output } = await run([CASES, ...args]);
    expect(code).toBe(1);
    expect(output).toContain(message);
  });

  it.each([
    ["a greeting", { action: { type: "talk", character_id: "char-nobody" } }, "action.character_id"],
    ["a talk-mode given", { given: { mode: "talk", talk_character_id: "char-nobody" }, action: { type: "end_talk" } }, "given.talk_character_id"],
  ])("refuses %s naming a character the blueprint lacks, before any narrator starts", async (_kind, fields, field) => {
    const marker = path.join(scratch, `narrator-started-${field}`);
    const wrapper = path.join(scratch, `marking-narrator-${field}.sh`);
    fs.writeFileSync(wrapper, `#!/bin/sh\ntouch "${marker}"\nexit 1\n`, { mode: 0o755 });
    const config = path.join(scratch, `marking-${field}.json`);
    fs.writeFileSync(config, JSON.stringify({ "narrator-marking": { cmd: wrapper, args: [], timeout_ms: 30_000 } }));
    const caseFile = path.join(scratch, `unknown-character-${field}.json`);
    fs.writeFileSync(caseFile, JSON.stringify({ id: "greet-nobody", blueprint: { path: MOCK_CASE_PATH }, given: { history: [] }, ...fields }));
    const startServer = vi.fn();

    const { code, output, runDir } = await run(
      [caseFile, "--narrator", "narrator-marking", "--judges", "flesch"],
      config,
      {},
      createJudgeTurnCommand({ startServer }),
    );

    expect(code).toBe(1);
    expect(output).toContain(`Case greet-nobody: ${field} "char-nobody" is not a character in blueprint`);
    expect(output).toContain(MOCK_CASE_PATH);
    expect(fs.existsSync(marker)).toBe(false);
    expect(startServer).not.toHaveBeenCalled();
    expect(runDir).toBe("");
  });

  it("prints its help", async () => {
    const { code, output } = await run(["--help"]);
    expect(code).toBe(0);
    expect(output).toContain("Usage: ./dev eval judge turn");
    expect(output).toContain("cases: their judges, else none; stored turns: earlier result's judges, else flesch");
  });

  it("finds nothing to judge in a folder with no cases", async () => {
    const empty = fs.mkdtempSync(path.join(scratch, "empty-"));
    const { code, output } = await run([empty]);
    expect(code).toBe(1);
    expect(output).toContain("no cases found");
  });
});

describe("judge turn names an AI from ai.json to a server narrator", () => {
  /** A config root of its own with an `ai.json`, which the run is pointed at. */
  function configRootWith(ais: unknown): Record<string, string> {
    const root = fs.mkdtempSync(path.join(scratch, "ai-root-"));
    fs.writeFileSync(path.join(root, "ai.json"), JSON.stringify({ ais }));
    return { MYSTERY_CONFIG_ROOT: root };
  }

  const ARGS = [CASES, "--narrator", "server", "--judges", "flesch"];

  it("gives the server an ai.json with the one AI the flag names", async () => {
    const env = configRootWith({
      free: { backend: "openrouter", model: "vendor/free", key: "sk-test-throwaway" },
      paid: { backend: "openrouter", model: "vendor/paid", key: "sk-test-other" },
    });
    let written: unknown = null;
    const startServer = vi.fn(async ({ seed }: { seed?: (root: string) => void }) => {
      const root = fs.mkdtempSync(path.join(scratch, "server-root-"));
      seed?.(root);
      written = JSON.parse(fs.readFileSync(path.join(root, "ai.json"), "utf8"));
      throw new Error("no server in this test");
    });

    const { code, output } = await run([...ARGS, "--ai-profile", "free"], configFile, env, createJudgeTurnCommand({ startServer }));

    expect(startServer).toHaveBeenCalledTimes(1);
    expect(written).toEqual({ ais: { free: { backend: "openrouter", model: "vendor/free", key: "sk-test-throwaway" } } });
    expect(code).toBe(1);
    expect(output).toContain("no server in this test");
  });

  it("fails before any server starts, or any folder is written, for an AI ai.json lacks", async () => {
    const env = configRootWith({ free: { backend: "openrouter", model: "vendor/free", key: "sk-test-throwaway" } });
    const startServer = vi.fn();

    const { code, output, runDir } = await run([...ARGS, "--ai-profile", "luna"], configFile, env, createJudgeTurnCommand({ startServer }));

    expect(code).toBe(1);
    expect(output).toMatch(/AI "luna" is not in .*ai\.json/);
    expect(startServer).not.toHaveBeenCalled();
    expect(runDir).toBe("");
  });

  it("fails the same way for an OpenRouter AI with no key anywhere", async () => {
    const env = configRootWith({ free: { backend: "openrouter", model: "vendor/free" } });
    const { code, output } = await run([...ARGS, "--ai-profile", "free"], configFile, env, createJudgeTurnCommand({ startServer: vi.fn() }));
    expect(code).toBe(1);
    expect(output).toContain('AI "free" uses openrouter but has no key');
  });

  it("needs no ai.json for a run that names none, or only mock", async () => {
    const env = configRootWith({});
    for (const flag of [[], ["--ai-profile", "mock"]]) {
      const startServer = vi.fn(async () => {
        throw new Error("no server in this test");
      });
      const { output } = await run([...ARGS, ...flag], configFile, env, createJudgeTurnCommand({ startServer }));
      expect(output).toContain("no server in this test");
      const [{ seed }] = startServer.mock.calls[0] as unknown as [{ seed?: unknown }];
      expect(seed).toBeUndefined();
    }
  });
});
