import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ResolvedBinding } from "../../../evaluation/core/config.ts";
import { promptSha256, runModel } from "../../../evaluation/core/runner.ts";
import type { ModelCallRequest } from "../../../evaluation/core/runner.ts";

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

  it("lets the wrapper stream events to the file it was given", async () => {
    await call("stream");
    const stream = fs.readFileSync(path.join(logDir(), "judge-x.attempt-1.stream.jsonl"), "utf8");
    expect(stream).toContain("thinking aloud");
  });
});
