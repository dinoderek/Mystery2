// The game's AI call log read back as model calls: what a logged call becomes in
// a result, and what never reaches one.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ModelCallSchema, sumTokens } from "../../../evaluation/core/result.ts";
import { promptSha256 } from "../../../evaluation/core/runner.ts";
import { modelCallFromLine, readAICallLog, readModelCalls, SERVER_BINDING } from "../../../evaluation/lib/game-ai-calls.ts";
import type { AICallLine } from "../../../evaluation/lib/game-ai-calls.ts";

let scratch = "";

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-game-ai-calls-"));
});

afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

/** A line as `withCallLog` writes it. */
function line(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    ts: "2026-11-25T10:00:00.000Z",
    game_id: "game-1",
    endpoint: "game-turn",
    action: "ask",
    request_id: "req-1",
    role: "ask",
    provider: "claude-cli",
    model: "haiku",
    resolved_model: "claude-haiku-4-5",
    prompt: "TELL THE STORY",
    context: { clue: "the jar" },
    output: { narration: "SECRET ANSWER" },
    parsed_ok: true,
    error: null,
    latency_ms: 2500,
    input_tokens: 1200,
    output_tokens: 90,
    cost_usd: 0.0031,
    attempts: 1,
    ...over,
  };
}

function writeLog(name: string, lines: unknown[]): string {
  const file = path.join(scratch, name);
  fs.writeFileSync(file, lines.map((each) => `${JSON.stringify(each)}\n`).join(""));
  return file;
}

function parsed(over: Partial<Record<string, unknown>> = {}): AICallLine {
  const file = writeLog(`one-${Math.random()}.jsonl`, [line(over)]);
  return readAICallLog(file, () => true)[0];
}

describe("a logged call as a model call", () => {
  it("carries its duration, cost and tokens, and names the model the provider resolved", () => {
    const call = modelCallFromLine(parsed());
    expect(() => ModelCallSchema.parse(call)).not.toThrow();
    expect(call).toMatchObject({
      binding: SERVER_BINDING,
      model: "claude-haiku-4-5",
      duration_ms: 2500,
      cost_usd: 0.0031,
      tokens: { input: 1200, output: 90, cache_read: null, cache_write: null },
      attempts: [{ attempt: 1, outcome: "ok", duration_ms: 2500, cost_usd: 0.0031 }],
    });
    // The call's tokens are its one attempt's.
    expect(call.tokens).toEqual(call.attempts[0].tokens);
  });

  it("falls back to the profile's model when the provider resolved none", () => {
    expect(modelCallFromLine(parsed({ resolved_model: null, model: "mock" })).model).toBe("mock");
  });

  it("gives null tokens and cost for a call whose provider reported no usage", () => {
    const call = modelCallFromLine(parsed({ input_tokens: null, output_tokens: null, cost_usd: null, provider: "mock" }));
    expect(call).toMatchObject({ duration_ms: 2500, cost_usd: null, tokens: null });
    expect(call.attempts[0]).toMatchObject({ cost_usd: null, tokens: null });
  });

  it("keeps a failed call's outcome: refused by the parser, timed out, or otherwise failed", () => {
    const outcome = (over: Record<string, unknown>) => modelCallFromLine(parsed(over)).attempts[0].outcome;
    expect(outcome({ parsed_ok: false, error: "Error: bad shape", output: { oops: true } })).toBe("invalid");
    expect(outcome({ parsed_ok: false, error: "Error: claude CLI timed out after 90000ms", output: null })).toBe("timeout");
    expect(outcome({ parsed_ok: false, error: "Error: exit 1", output: null })).toBe("exit");
  });

  it("holds the prompt's hash and no text of the prompt, the answer or an error", () => {
    const call = modelCallFromLine(parsed({ parsed_ok: false, error: "Error: SECRET ANSWER was refused", output: { narration: "SECRET ANSWER" } }));
    expect(call.prompt_sha256).toBe(promptSha256("TELL THE STORY", JSON.stringify({ clue: "the jar" })));
    expect(JSON.stringify(call)).not.toMatch(/SECRET|TELL THE STORY|the jar/);
  });

  it("hashes a call with no context, such as narration, on its prompt alone", () => {
    expect(modelCallFromLine(parsed({ context: null })).prompt_sha256).toBe(promptSha256("TELL THE STORY", ""));
  });
});

describe("reading the log", () => {
  it("gives the calls the filter keeps, in the order they were logged", () => {
    const file = writeLog("filtered.jsonl", [line({ request_id: "a", latency_ms: 1 }), line({ request_id: "b" }), line({ request_id: "a", latency_ms: 3 })]);
    expect(readModelCalls(file, (each) => each.request_id === "a").map((call) => call.duration_ms)).toEqual([1, 3]);
  });

  it("gives none for a log that was never written, or no log", () => {
    expect(readAICallLog(path.join(scratch, "missing.jsonl"), () => true)).toEqual([]);
    expect(readAICallLog(null, () => true)).toEqual([]);
  });

  it("leaves a last line still being written, which has no newline yet", () => {
    const file = path.join(scratch, "unfinished.jsonl");
    fs.writeFileSync(file, `${JSON.stringify(line({ latency_ms: 7 }))}\n${JSON.stringify(line()).slice(0, 60)}`);
    expect(readModelCalls(file, () => true).map((call) => call.duration_ms)).toEqual([7]);
  });

  it("fails on a line it cannot read, naming the file and the line", () => {
    const file = path.join(scratch, "broken.jsonl");
    fs.writeFileSync(file, `${JSON.stringify(line())}\n{"half":\n`);
    expect(() => readAICallLog(file, () => true)).toThrow(/broken\.jsonl line 2 is not JSON/);
    const odd = writeLog("odd.jsonl", [line(), { game_id: "x" }]);
    expect(() => readAICallLog(odd, () => true)).toThrow(/odd\.jsonl line 2 is not an AI call log line/);
  });
});

describe("tokens without cache counts", () => {
  it("sum field by field, a cache count null only when no call reported one", () => {
    const game = { input: 10, output: 2, cache_read: null, cache_write: null };
    const cli = { input: 5, output: 1, cache_read: 4, cache_write: 0 };
    expect(sumTokens([game, game])).toEqual({ input: 20, output: 4, cache_read: null, cache_write: null });
    expect(sumTokens([game, cli])).toEqual({ input: 15, output: 3, cache_read: 4, cache_write: 0 });
  });
});
