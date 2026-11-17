import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ResolvedBinding } from "../../../evaluation/core/config.ts";
import { UsageLimitError } from "../../../evaluation/core/errors.ts";
import { promptSha256, runModel } from "../../../evaluation/core/runner.ts";
import type { CallMemo, FinishedCall, ModelCallRequest } from "../../../evaluation/core/runner.ts";

const FAKE = path.join(__dirname, "eval-core-fake-wrapper.mjs");

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-core-runner-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function binding(overrides: Partial<ResolvedBinding> = {}): ResolvedBinding {
  return {
    name: "fake",
    cmd: process.execPath,
    command: process.execPath,
    args: [FAKE, "{{system_prompt_file}}", "{{user_message_file}}"],
    extract_path: "result",
    model: "fake-model",
    timeout_ms: 10_000,
    retries: 0,
    ...overrides,
  };
}

const logDir = () => path.join(dir, "logs");
const record = () => path.join(dir, "record.jsonl");

function call<T = string>(steps: string, overrides: Partial<ModelCallRequest<T>> = {}, bindingOverrides = {}) {
  return runModel<T>({
    binding: binding(bindingOverrides),
    step: "judge-x",
    systemPrompt: "SYSTEM",
    userMessage: "USER",
    logDir: logDir(),
    env: {
      FAKE_WRAPPER_STEPS: steps,
      FAKE_WRAPPER_COUNTER: path.join(dir, "counter"),
      FAKE_WRAPPER_RECORD: record(),
    },
    ...overrides,
  });
}

function recorded(): Array<Record<string, unknown>> {
  return fs
    .readFileSync(record(), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

const parseAnswer = (answer: string) => {
  const value = JSON.parse(answer);
  if (value.answer !== 42) throw new Error(`answer must be 42, got ${value.answer}`);
  return value as { answer: number };
};

describe("runModel", () => {
  it("returns the answer, the parsed value, the model, the prompt hash, the time and the cost", async () => {
    const result = await call("ok", { parse: parseAnswer });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answer).toBe('{"answer":42}');
    expect(result.value).toEqual({ answer: 42 });
    expect(result.call).toMatchObject({
      binding: "fake",
      model: "fake-model",
      cost_usd: 0.25,
      attempts: [{ attempt: 1, outcome: "ok", cost_usd: 0.25 }],
    });
    const expected = createHash("sha256").update("SYSTEM\0USER").digest("hex");
    expect(result.call.prompt_sha256).toBe(expected);
    expect(promptSha256("SYSTEM", "USER")).toBe(expected);
    expect(result.call.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("writes the prompts to files the wrapper reads, and hands it the model and a stream file", async () => {
    await call("ok");

    const [seen] = recorded();
    expect(seen).toMatchObject({ system: "SYSTEM", user: "USER", model: "fake-model" });
    expect(seen.stream).toBe(path.join(logDir(), "judge-x.attempt-1.stream.jsonl"));
    expect(fs.readFileSync(path.join(logDir(), "judge-x.system.txt"), "utf8")).toBe("SYSTEM");
    expect(fs.readFileSync(path.join(logDir(), "judge-x.user.txt"), "utf8")).toBe("USER");
  });

  it("hands the wrapper the answer's schema in a file, and no schema to a call without one, even one the caller's environment names", async () => {
    const answerSchema = { type: "object", required: ["answer"], properties: { answer: { type: "integer" } } };
    const first = await call("ok", { answerSchema });
    expect(first.call.prompt_sha256).toBe(promptSha256("SYSTEM", "USER"));
    const file = path.join(logDir(), "judge-x.schema.json");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(answerSchema);
    expect(JSON.parse(recorded()[0].schema as string)).toEqual(answerSchema);
    expect(JSON.parse(fs.readFileSync(path.join(logDir(), "judge-x.attempt-1.invocation.json"), "utf8")).json_schema_file).toBe(file);

    const before = process.env.EVAL_JSON_SCHEMA_FILE;
    process.env.EVAL_JSON_SCHEMA_FILE = file;
    try {
      await call("ok", { step: "judge-y" });
    } finally {
      if (before === undefined) delete process.env.EVAL_JSON_SCHEMA_FILE;
      else process.env.EVAL_JSON_SCHEMA_FILE = before;
    }
    expect(recorded()[1].schema).toBeNull();
    expect(JSON.parse(fs.readFileSync(path.join(logDir(), "judge-y.attempt-1.invocation.json"), "utf8")).json_schema_file).toBeNull();
  });

  it("gives a binding without a model no EVAL_MODEL, even one the caller's environment has", async () => {
    const before = process.env.EVAL_MODEL;
    process.env.EVAL_MODEL = "leaked";
    try {
      await call("ok", {}, { model: null });
    } finally {
      if (before === undefined) delete process.env.EVAL_MODEL;
      else process.env.EVAL_MODEL = before;
    }
    expect(recorded()[0].model).toBeNull();
  });

  it("keeps each attempt's stdout, stderr and invocation, naming only the environment it added", async () => {
    await call("exit,ok", {}, { retries: 1 });

    const files = fs.readdirSync(logDir()).sort();
    for (const attempt of [1, 2]) {
      for (const suffix of ["stdout.log", "stderr.log", "invocation.json"]) {
        expect(files).toContain(`judge-x.attempt-${attempt}.${suffix}`);
      }
    }
    expect(fs.readFileSync(path.join(logDir(), "judge-x.attempt-1.stderr.log"), "utf8")).toContain("fake wrapper failed");
    const invocation = JSON.parse(fs.readFileSync(path.join(logDir(), "judge-x.attempt-2.invocation.json"), "utf8"));
    expect(invocation).toMatchObject({ binding: "fake", exit_code: 0, timed_out: false, model: "fake-model" });
    expect(invocation.args.slice(1)).toEqual([
      path.join(logDir(), "judge-x.system.txt"),
      path.join(logDir(), "judge-x.user.txt"),
    ]);
    expect(invocation.env_added).toEqual(["FAKE_WRAPPER_STEPS", "FAKE_WRAPPER_COUNTER", "FAKE_WRAPPER_RECORD"]);
    expect(JSON.stringify(invocation)).not.toContain("exit,ok");
  });

  it.each([
    ["exit", "exit", /exited with code 3. stderr: fake wrapper failed/],
    ["not_json", "not_json", /stdout is not JSON/],
    ["no_path", "not_json", /extract_path "result" not found/],
    ["invalid", "invalid", /answer must be 42, got no/],
  ])("retries after %s and succeeds on the next attempt", async (first, outcome, message) => {
    const result = await call(`${first},ok`, { parse: parseAnswer }, { retries: 1 });

    expect(result.ok).toBe(true);
    expect(result.call.attempts.map((attempt) => attempt.outcome)).toEqual([outcome, "ok"]);
    expect(result.call.attempts[0].error).toMatch(message);
  });

  it("kills a wrapper and its children at the timeout, and retries", async () => {
    const result = await call("hang,ok", {}, { retries: 1, timeout_ms: 500 });

    expect(result.ok).toBe(true);
    expect(result.call.attempts[0]).toMatchObject({ outcome: "timeout", error: "timed out after 500ms" });
    expect(result.call.attempts[0].duration_ms).toBeLessThan(5_000);
  });

  it("gives up after its retries, with every attempt and the last error", async () => {
    const result = await call("exit,not_json,invalid", { parse: parseAnswer }, { retries: 2 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.call.attempts.map((attempt) => attempt.outcome)).toEqual(["exit", "not_json", "invalid"]);
    expect(result.error).toMatch(/binding "fake" failed after 3 attempt\(s\): answer must be 42/);
    expect(result.call.cost_usd).toBe(0.1);
  });

  it("makes one attempt when the binding allows no retries", async () => {
    const result = await call("exit,ok");
    expect(result.ok).toBe(false);
    expect(result.call.attempts).toHaveLength(1);
  });

  it("records no cost when the CLI reports none, and sums the costs it does report", async () => {
    const none = await call("nocost");
    expect(none.call.cost_usd).toBeNull();
    expect(none.call.attempts[0].cost_usd).toBeNull();

    fs.rmSync(path.join(dir, "counter"));
    const summed = await call("invalid,ok", { parse: parseAnswer }, { retries: 1 });
    expect(summed.call.cost_usd).toBeCloseTo(0.35);
  });

  it("takes the whole of stdout as the answer when there is no extract path", async () => {
    const result = await call("bare", {}, { extract_path: null });
    expect(result.ok && result.answer).toBe('{"answer":42}');
  });

  it("rejects an extract path that names something other than a string", async () => {
    const result = await call("ok", {}, { extract_path: "total_cost_usd" });
    expect(result.ok).toBe(false);
    expect(result.call.attempts[0].error).toMatch(/not a string/);
  });

  it("takes plain text as it is when asked for text", async () => {
    const result = await call("text", { output: "text" });
    expect(result.ok && result.answer).toBe("plain narration");
    expect(result.call.cost_usd).toBeNull();
  });

  it("records a wrapper that cannot start as a failed attempt", async () => {
    const result = await call("ok", {}, { command: path.join(dir, "missing") });
    expect(result.ok).toBe(false);
    expect(result.call.attempts[0]).toMatchObject({ outcome: "exit" });
    expect(result.call.attempts[0].error).toMatch(/could not start/);
  });

  it("reads the cost from the stream's result event when stdout carries none", async () => {
    const result = await call("streamed_cost");
    expect(result.call.cost_usd).toBe(1.5);

    fs.rmSync(path.join(dir, "counter"));
    const rejected = await call("streamed_cost", { parse: () => { throw new Error("no"); } });
    expect(rejected.call.attempts[0]).toMatchObject({ outcome: "invalid", cost_usd: 1.5 });
  });

  it("kills every running wrapper and its children when the process is interrupted", async () => {
    const pidsFile = path.join(dir, "pids.json");
    const script = `
      const { runModel } = await import(${JSON.stringify(path.resolve(__dirname, "../../../evaluation/core/runner.ts"))});
      await runModel({
        binding: ${JSON.stringify(binding({ timeout_ms: 60_000 }))},
        step: "hang", systemPrompt: "s", userMessage: "u", logDir: ${JSON.stringify(logDir())},
        env: { FAKE_WRAPPER_STEPS: "hang", FAKE_WRAPPER_PIDS: ${JSON.stringify(pidsFile)} },
      });`;
    const runner = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: "ignore" });
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const until = async (check: () => boolean) => {
      for (let i = 0; i < 100 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
      return check();
    };

    expect(await until(() => fs.existsSync(pidsFile) && fs.statSync(pidsFile).size > 0)).toBe(true);
    const pids: number[] = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
    expect(pids.every(alive)).toBe(true);

    const exited = new Promise<NodeJS.Signals | null>((resolve) => runner.on("exit", (_code, signal) => resolve(signal)));
    runner.kill("SIGINT");
    expect(await exited).toBe("SIGINT");
    expect(await until(() => !pids.some(alive))).toBe(true);
  });

  it("lets the wrapper stream events to the file it was given", async () => {
    await call("stream");
    const stream = fs.readFileSync(path.join(logDir(), "judge-x.attempt-1.stream.jsonl"), "utf8");
    expect(stream).toContain("thinking aloud");
  });
});

describe("the usage limit", () => {
  it("throws at once, with what the CLI said, and makes no further attempt", async () => {
    const kept: FinishedCall[] = [];
    const memo: CallMemo = { recall: () => null, keep: (_hash, finished) => kept.push(finished) };
    const error = await call("limit,ok", { memo }, { retries: 2 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UsageLimitError);
    expect((error as UsageLimitError).said).toBe("You've hit your weekly limit \u00b7 resets Mon 9am (Europe/London)");
    expect((error as Error).message).toContain('binding "fake"');
    expect(recorded()).toHaveLength(1);
    expect(kept).toEqual([]);
  });

  it("is not taken from an ordinary failure", async () => {
    const result = await call("exit");
    expect(result.ok).toBe(false);
  });
});

describe("a memo of finished calls", () => {
  function memoOf(calls: Map<string, FinishedCall>): CallMemo {
    return { recall: (hash) => calls.get(hash) ?? null, keep: (hash, finished) => calls.set(hash, finished) };
  }

  it("keeps each finished call by its prompt hash, and answers the same prompt from it with no wrapper", async () => {
    const calls = new Map<string, FinishedCall>();
    const first = await call("ok", { memo: memoOf(calls), parse: parseAnswer });
    expect(first.ok).toBe(true);
    expect([...calls.keys()]).toEqual([promptSha256("SYSTEM", "USER")]);
    fs.rmSync(logDir(), { recursive: true });
    const again = await call("ok", { memo: memoOf(calls), parse: parseAnswer });
    expect(again).toEqual(first);
    expect(recorded()).toHaveLength(1);
    expect(fs.existsSync(logDir())).toBe(false);
  });

  it("answers a kept failure as the failure", async () => {
    const calls = new Map<string, FinishedCall>();
    const failed = await call("exit", { memo: memoOf(calls) });
    expect(failed.ok).toBe(false);
    expect(await call("ok", { memo: memoOf(calls) })).toEqual(failed);
    expect(recorded()).toHaveLength(1);
  });

  it("makes the call again when a kept answer no longer parses", async () => {
    const calls = new Map<string, FinishedCall>();
    await call("invalid,invalid", { memo: memoOf(calls) });
    const result = await call("ok", { memo: memoOf(calls), parse: parseAnswer }, { retries: 0 });
    expect(result.ok).toBe(true);
    expect(recorded()).toHaveLength(2);
  });

  it("makes a call whose prompt differs", async () => {
    const calls = new Map<string, FinishedCall>();
    await call("ok", { memo: memoOf(calls) });
    await call("ok", { memo: memoOf(calls), userMessage: "OTHER" });
    expect(recorded()).toHaveLength(2);
    expect(calls.size).toBe(2);
  });
});
