/**
 * The model runner: the one way evaluation code makes a model call.
 *
 * A call names a resolved binding (`config.ts`), a system prompt and a user
 * message. The runner writes both to files in the call's log folder, starts
 * the binding's wrapper with their paths, enforces the timeout, reads the
 * answer from stdout and retries on a non-zero exit, a timeout, output that is
 * not JSON, or an answer the caller's `parse` rejects. It never throws for a
 * failed call: it returns `ok: false` with every attempt recorded.
 *
 * The wrapper's environment adds:
 *
 * - `EVAL_MODEL`: the binding's model, when it has one. A wrapper passes it to
 *   its CLI instead of naming a model itself.
 * - `EVAL_STREAM_FILE`: where the wrapper may stream its CLI's events, one JSON
 *   object per line, for the live progress digest (`progress.ts`).
 *
 * Each attempt leaves `<step>.attempt-<n>.stdout.log`, `.stderr.log` and
 * `.invocation.json` in the log folder, written as the wrapper runs.
 *
 * Cost is read from `total_cost_usd` at the top of the wrapper's JSON stdout,
 * where the Claude CLI's `--output-format json` envelope puts it. A wrapper
 * whose CLI reports no cost, or that prints the answer bare, records null.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import type { ResolvedBinding } from "./config.ts";
import type { Attempt, ModelCall } from "./result.ts";

export interface ModelCallRequest<T> {
  binding: ResolvedBinding;
  /** Names this call's files in `logDir`, e.g. `judge-fairness`. */
  step: string;
  systemPrompt: string;
  userMessage: string;
  logDir: string;
  /**
   * Turns the answer into the caller's value. Throwing rejects the answer and
   * the attempt is retried, with the error's message recorded.
   */
  parse?: (answer: string) => T;
  /** `json` (the default): stdout must be JSON. `text`: stdout is the answer as it is. */
  output?: "json" | "text";
  /** Added to the wrapper's environment. Only the names are logged, never the values. */
  env?: Record<string, string>;
}

export type ModelCallResult<T> =
  | { ok: true; answer: string; value: T; call: ModelCall }
  | { ok: false; error: string; call: ModelCall };

/** SHA-256 of the system prompt, a NUL byte and the user message. */
export function promptSha256(systemPrompt: string, userMessage: string): string {
  return createHash("sha256").update(systemPrompt).update("\0").update(userMessage).digest("hex");
}

class AttemptFailure extends Error {
  readonly outcome: Exclude<Attempt["outcome"], "ok">;
  readonly costUsd: number | null;

  constructor(outcome: Exclude<Attempt["outcome"], "ok">, message: string, costUsd: number | null = null) {
    super(message);
    this.outcome = outcome;
    this.costUsd = costUsd;
  }
}

interface Spawned {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  spawnError: Error | null;
}

function closeStream(stream: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve) => stream.end(resolve));
}

/** Kills the wrapper and everything it started: wrappers run their CLI as a child. */
function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

async function startWrapper(
  binding: ResolvedBinding,
  args: string[],
  env: NodeJS.ProcessEnv,
  logStem: string,
): Promise<Spawned> {
  const stdoutLog = createWriteStream(`${logStem}.stdout.log`);
  const stderrLog = createWriteStream(`${logStem}.stderr.log`);
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const outcome = await new Promise<Omit<Spawned, "stdout" | "stderr">>((resolve) => {
    let timedOut = false;
    const child = spawn(binding.command, args, { stdio: ["ignore", "pipe", "pipe"], env, detached: true });
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, binding.timeout_ms);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      stdoutLog.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      stderrLog.write(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, timedOut, spawnError: error });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, timedOut, spawnError: null });
    });
  });
  await Promise.all([closeStream(stdoutLog), closeStream(stderrLog)]);
  return {
    ...outcome,
    stdout: Buffer.concat(stdout).toString("utf8").trim(),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

function walk(value: unknown, dotted: string): unknown {
  let cursor = value;
  for (const part of dotted.split(".").filter(Boolean)) {
    if (!cursor || typeof cursor !== "object" || !(part in cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function reportedCost(parsed: unknown): number | null {
  const cost = walk(parsed, "total_cost_usd");
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : null;
}

/** The answer in the wrapper's stdout, and the cost it reports. Throws an `AttemptFailure`. */
function readAnswer(binding: ResolvedBinding, run: Spawned, output: "json" | "text"): { answer: string; costUsd: number | null } {
  if (run.spawnError) throw new AttemptFailure("exit", `could not start ${binding.command}: ${run.spawnError.message}`);
  if (run.timedOut) throw new AttemptFailure("timeout", `timed out after ${binding.timeout_ms}ms`);
  if (run.exitCode !== 0) {
    throw new AttemptFailure("exit", `exited with code ${run.exitCode}. stderr: ${run.stderr.slice(0, 1000)}`);
  }
  if (output === "text") return { answer: run.stdout, costUsd: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    throw new AttemptFailure("not_json", `stdout is not JSON. First 500 chars: ${run.stdout.slice(0, 500)}`);
  }
  const costUsd = reportedCost(parsed);
  if (binding.extract_path === null) return { answer: run.stdout, costUsd };
  const answer = walk(parsed, binding.extract_path);
  if (typeof answer !== "string") {
    const why = answer === undefined ? "not found" : "not a string";
    throw new AttemptFailure("not_json", `extract_path "${binding.extract_path}" ${why} in stdout JSON`, costUsd);
  }
  return { answer, costUsd };
}

async function writeInvocation(file: string, record: Record<string, unknown>): Promise<void> {
  await fs.writeFile(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

interface AttemptContext<T> {
  request: ModelCallRequest<T>;
  args: string[];
  promptFiles: { system: string; user: string };
}

async function runAttempt<T>(
  { request, args, promptFiles }: AttemptContext<T>,
  attempt: number,
): Promise<{ record: Attempt; answer?: string; value?: T }> {
  const { binding, logDir, step } = request;
  const logStem = path.join(logDir, `${step}.attempt-${attempt}`);
  const streamFile = `${logStem}.stream.jsonl`;
  const env: NodeJS.ProcessEnv = { ...process.env, ...request.env, EVAL_STREAM_FILE: streamFile };
  if (binding.model) env.EVAL_MODEL = binding.model;
  else delete env.EVAL_MODEL;

  const startedAt = performance.now();
  const run = await startWrapper(binding, args, env, logStem);
  const durationMs = Math.round(performance.now() - startedAt);
  await writeInvocation(`${logStem}.invocation.json`, {
    binding: binding.name,
    command: binding.command,
    args,
    model: binding.model,
    env_added: Object.keys(request.env ?? {}),
    exit_code: run.exitCode,
    timed_out: run.timedOut,
    duration_ms: durationMs,
    system_prompt_file: promptFiles.system,
    user_message_file: promptFiles.user,
    stream_file: streamFile,
  });

  let costUsd: number | null = null;
  try {
    const read = readAnswer(binding, run, request.output ?? "json");
    costUsd = read.costUsd;
    let value: T;
    try {
      value = request.parse ? request.parse(read.answer) : (read.answer as T);
    } catch (error) {
      throw new AttemptFailure("invalid", (error as Error).message ?? String(error), costUsd);
    }
    return { record: { attempt, outcome: "ok", duration_ms: durationMs, cost_usd: costUsd }, answer: read.answer, value };
  } catch (error) {
    if (!(error instanceof AttemptFailure)) throw error;
    return {
      record: {
        attempt,
        outcome: error.outcome,
        duration_ms: durationMs,
        cost_usd: error.costUsd ?? costUsd,
        error: error.message.slice(0, 500),
      },
    };
  }
}

function totalCost(attempts: readonly Attempt[]): number | null {
  const costs = attempts.map((attempt) => attempt.cost_usd).filter((cost): cost is number => cost !== null);
  return costs.length === 0 ? null : costs.reduce((sum, cost) => sum + cost, 0);
}

/** Makes one model call through its binding's wrapper, with the binding's retries. */
export async function runModel<T = string>(request: ModelCallRequest<T>): Promise<ModelCallResult<T>> {
  const { binding, logDir, step, systemPrompt, userMessage } = request;
  await fs.mkdir(logDir, { recursive: true });
  const promptFiles = {
    system: path.join(logDir, `${step}.system.txt`),
    user: path.join(logDir, `${step}.user.txt`),
  };
  await fs.writeFile(promptFiles.system, systemPrompt, "utf8");
  await fs.writeFile(promptFiles.user, userMessage, "utf8");
  const args = binding.args.map((arg) =>
    arg.replaceAll("{{system_prompt_file}}", promptFiles.system).replaceAll("{{user_message_file}}", promptFiles.user),
  );

  const startedAt = performance.now();
  const attempts: Attempt[] = [];
  const context: AttemptContext<T> = { request, args, promptFiles };
  let success: { answer: string; value: T } | null = null;
  for (let attempt = 1; attempt <= 1 + binding.retries && !success; attempt += 1) {
    const outcome = await runAttempt(context, attempt);
    attempts.push(outcome.record);
    if (outcome.record.outcome === "ok") success = { answer: outcome.answer as string, value: outcome.value as T };
  }

  const call: ModelCall = {
    binding: binding.name,
    model: binding.model,
    prompt_sha256: promptSha256(systemPrompt, userMessage),
    duration_ms: Math.round(performance.now() - startedAt),
    cost_usd: totalCost(attempts),
    attempts,
  };
  if (success) return { ok: true, ...success, call };
  const last = attempts[attempts.length - 1];
  return { ok: false, error: `binding "${binding.name}" failed after ${attempts.length} attempt(s): ${last.error}`, call };
}
