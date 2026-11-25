/**
 * The game's own AI call log (`AI_CALL_LOG`, `packages/game-engine/src/ai-call-log.ts`)
 * read back as model calls, for the commands that narrate through the game:
 * `judge turn --narrator server` and `play`.
 *
 * A line holds the whole prompt and the model's answer, and goes nowhere but
 * the run's own folder. What this turns it into holds the metrics and the
 * prompt's hash only, and no error text, which can quote the answer.
 */

import fs from "node:fs";

import { z } from "zod";

import { promptSha256 } from "../core/runner.ts";
import type { Attempt, ModelCall } from "../core/result.ts";

/** What a model call made by the game is recorded under, as the runs' bindings name the server narrator. */
export const SERVER_BINDING = "server";

const Count = z.number().int().min(0);

/** The part of a log line the record reads; the rest of the line is left alone. */
const LogLineSchema = z
  .object({
    request_id: z.string().nullable(),
    game_id: z.string().nullable(),
    model: z.string(),
    resolved_model: z.string().nullable().default(null),
    prompt: z.string(),
    context: z.record(z.unknown()).nullable(),
    parsed_ok: z.boolean(),
    error: z.string().nullable(),
    output: z.unknown(),
    latency_ms: Count,
    input_tokens: Count.nullable(),
    output_tokens: Count.nullable(),
    cost_usd: z.number().min(0).nullable(),
  })
  .passthrough();
export type AICallLine = z.infer<typeof LogLineSchema>;

/**
 * Every line of the log `keep` accepts, in the order the game wrote them; none
 * when there is no log. A line that is not a log line stops the read, naming it.
 */
export function readAICallLog(file: string | null, keep: (line: AICallLine) => boolean): AICallLine[] {
  if (file === null || !fs.existsSync(file)) return [];
  const lines: AICallLine[] = [];
  const segments = fs.readFileSync(file, "utf8").split("\n");
  // The server appends while a run reads: a last line without its newline is still being written, and is
  // never one of a finished request's, whose lines are complete before it answers.
  segments.pop();
  segments.forEach((text, index) => {
    if (text === "") return;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new Error(`${file} line ${index + 1} is not JSON: ${(error as Error).message}`, { cause: error });
    }
    const parsed = LogLineSchema.safeParse(value);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
      throw new Error(`${file} line ${index + 1} is not an AI call log line: ${issues}`);
    }
    if (keep(parsed.data)) lines.push(parsed.data);
  });
  return lines;
}

/** Why a failed call failed, as far as the line says; `invalid` is an answer the parser refused. */
function failureOutcome(line: AICallLine): Attempt["outcome"] {
  if (line.parsed_ok && line.error === null) return "ok";
  if (line.output !== null && line.output !== undefined) return "invalid";
  return /timed out|timeout/i.test(line.error ?? "") ? "timeout" : "exit";
}

/**
 * One logged call as a model call under `binding`. The log keeps the call's
 * total, retries and all, so it is one attempt: the model is the provider's
 * resolved one, cost and tokens are null when the provider reported none, and
 * tokens carry no cache counts (the game folds them into input).
 */
export function modelCallFromLine(line: AICallLine, binding: string = SERVER_BINDING): ModelCall {
  const tokens =
    line.input_tokens === null || line.output_tokens === null
      ? null
      : { input: line.input_tokens, output: line.output_tokens, cache_read: null, cache_write: null };
  return {
    binding,
    model: line.resolved_model ?? line.model,
    // The log's prompt is the whole instruction; the context a role was given is the rest of what the model saw.
    prompt_sha256: promptSha256(line.prompt, line.context === null ? "" : JSON.stringify(line.context)),
    duration_ms: line.latency_ms,
    cost_usd: line.cost_usd,
    tokens,
    attempts: [{ attempt: 1, outcome: failureOutcome(line), duration_ms: line.latency_ms, cost_usd: line.cost_usd, tokens }],
  };
}

/** The calls the lines `keep` accepts, as model calls. */
export function readModelCalls(file: string | null, keep: (line: AICallLine) => boolean): ModelCall[] {
  return readAICallLog(file, keep).map((line) => modelCallFromLine(line));
}
