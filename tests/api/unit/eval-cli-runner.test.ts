import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { runCli, runCliWithRetries } from "../../../evaluation/pipeline/cli-runner.mjs";

const MOCK_CLI = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "eval-cli-runner-mock.mjs",
);

// Build a CLI step config that spawns the mock stub. `extractPath` defaults to
// "result" (the mock's ok output nests a JSON string there); pass null to test
// the extract-path-less return, or a dotted path to walk deeper.
function step({
  extractPath = "result" as string | null,
  timeoutMs = 10_000,
} = {}) {
  const config: {
    cmd: string;
    args: string[];
    timeout_ms: number;
    extract_path?: string;
  } = {
    cmd: "node",
    args: [MOCK_CLI, "{{system_prompt_file}}", "{{user_message_file}}"],
    timeout_ms: timeoutMs,
  };
  if (extractPath) config.extract_path = extractPath;
  return config;
}

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "cli-runner-test-"));
}

async function runOnce(
  config: ReturnType<typeof step>,
  overrides: Record<string, unknown> = {},
) {
  const dir = await tmpDir();
  return runCli({
    step: "mock",
    config,
    systemPrompt: "sys",
    userMessage: "user",
    logDir: path.join(dir, "logs"),
    ...overrides,
  });
}

async function runWithRetries(
  config: ReturnType<typeof step>,
  overrides: Record<string, unknown> = {},
) {
  const dir = await tmpDir();
  return runCliWithRetries({
    step: "mock",
    config,
    systemPrompt: "sys",
    userMessage: "user",
    logDir: path.join(dir, "logs"),
    ...overrides,
  });
}

const originalMode = process.env.MOCK_CLI_MODE;
afterEach(() => {
  if (originalMode === undefined) delete process.env.MOCK_CLI_MODE;
  else process.env.MOCK_CLI_MODE = originalMode;
});

describe("runCli extract_path dotted-walk", () => {
  it("walks a single-segment path and returns the string value", async () => {
    process.env.MOCK_CLI_MODE = "ok";
    const result = await runOnce(step({ extractPath: "result" }));
    // The mock nests a JSON string at .result; the runner returns it verbatim.
    expect(result.extracted).toBe(JSON.stringify({ answer: 42 }));
    expect(result.raw).toEqual({ result: JSON.stringify({ answer: 42 }) });
  });

  it("returns the whole trimmed stdout when no extract_path is set", async () => {
    process.env.MOCK_CLI_MODE = "plain_string";
    const result = await runOnce(step({ extractPath: null }));
    expect(result.extracted).toBe(JSON.stringify({ answer: 42 }));
    expect(result.raw).toEqual({ answer: 42 });
  });

  it("throws when the dotted path is missing from the JSON", async () => {
    process.env.MOCK_CLI_MODE = "missing_path";
    await expect(runOnce(step({ extractPath: "result" }))).rejects.toThrow(
      /extract_path "result" not found/,
    );
  });

  it("throws the non-string guard when the path resolves to a non-string", async () => {
    process.env.MOCK_CLI_MODE = "nested_object";
    await expect(runOnce(step({ extractPath: "result" }))).rejects.toThrow(
      /resolved to non-string value/,
    );
  });

  it("throws when stdout is not valid JSON", async () => {
    process.env.MOCK_CLI_MODE = "not_json";
    await expect(runOnce(step())).rejects.toThrow(/stdout is not valid JSON/);
  });

  it("throws with the exit code when the process crashes", async () => {
    process.env.MOCK_CLI_MODE = "crash";
    await expect(runOnce(step())).rejects.toThrow(/exited with code 1/);
  });

  it("throws a timeout error when the process runs past the budget", async () => {
    process.env.MOCK_CLI_MODE = "hang";
    await expect(runOnce(step({ timeoutMs: 200 }))).rejects.toThrow(
      /timed out after 200ms/,
    );
  });
});

describe("runCliWithRetries attempt accounting", () => {
  it("records a single ok attempt on a clean first run", async () => {
    process.env.MOCK_CLI_MODE = "ok";
    const outcome = await runWithRetries(step(), { retries: 2 });
    expect(outcome.ok).toBe(true);
    expect(outcome.extracted).toBe(JSON.stringify({ answer: 42 }));
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.attempts[0].outcome).toBe("ok");
    expect(outcome.attempts[0].attempt).toBe(1);
  });

  it("classifies a crashing process as cli_fail and retries to the budget", async () => {
    process.env.MOCK_CLI_MODE = "crash";
    const outcome = await runWithRetries(step(), { retries: 2 });
    expect(outcome.ok).toBe(false);
    // 1 initial attempt + 2 retries = 3 recorded attempts, all cli_fail.
    expect(outcome.attempts).toHaveLength(3);
    expect(
      outcome.attempts.every((a: { outcome: string }) => a.outcome === "cli_fail"),
    ).toBe(true);
    expect(outcome.attempts.map((a: { attempt: number }) => a.attempt)).toEqual([
      1, 2, 3,
    ]);
    expect(outcome.error.message).toMatch(/exited with code 1/);
  });

  it("classifies a timeout as cli_fail", async () => {
    process.env.MOCK_CLI_MODE = "hang";
    const outcome = await runWithRetries(step({ timeoutMs: 200 }), { retries: 0 });
    expect(outcome.ok).toBe(false);
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.attempts[0].outcome).toBe("cli_fail");
    expect(outcome.error.message).toMatch(/timed out/);
  });

  it("classifies a missing extract_path as cli_fail (runCli throws)", async () => {
    process.env.MOCK_CLI_MODE = "missing_path";
    const outcome = await runWithRetries(step(), { retries: 0 });
    expect(outcome.ok).toBe(false);
    expect(outcome.attempts[0].outcome).toBe("cli_fail");
    expect(outcome.error.message).toMatch(/not found/);
  });

  it("records parse_fail when validateExtracted rejects the output", async () => {
    process.env.MOCK_CLI_MODE = "ok";
    const outcome = await runWithRetries(step(), {
      retries: 1,
      validateExtracted: () => {
        throw new Error("bad shape");
      },
    });
    expect(outcome.ok).toBe(false);
    // Both attempts run the CLI cleanly but fail validation → parse_fail.
    expect(outcome.attempts).toHaveLength(2);
    expect(
      outcome.attempts.every((a: { outcome: string }) => a.outcome === "parse_fail"),
    ).toBe(true);
    expect(outcome.error.message).toBe("bad shape");
  });

  it("passes the extracted string to validateExtracted and returns ok when it accepts", async () => {
    process.env.MOCK_CLI_MODE = "ok";
    const seen: string[] = [];
    const outcome = await runWithRetries(step(), {
      retries: 1,
      validateExtracted: (value: string) => {
        seen.push(value);
      },
    });
    expect(outcome.ok).toBe(true);
    expect(seen).toEqual([JSON.stringify({ answer: 42 })]);
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.attempts[0].outcome).toBe("ok");
  });

  it("stops retrying and returns ok on the first clean attempt", async () => {
    process.env.MOCK_CLI_MODE = "ok";
    const outcome = await runWithRetries(step(), { retries: 3 });
    expect(outcome.ok).toBe(true);
    // Success short-circuits the loop: only the first attempt is recorded.
    expect(outcome.attempts).toHaveLength(1);
  });

  it("treats a negative or non-integer retry count as zero retries", async () => {
    process.env.MOCK_CLI_MODE = "crash";
    const negative = await runWithRetries(step(), { retries: -5 });
    expect(negative.attempts).toHaveLength(1);
    const fractional = await runWithRetries(step(), { retries: 1.5 });
    expect(fractional.attempts).toHaveLength(1);
  });
});
