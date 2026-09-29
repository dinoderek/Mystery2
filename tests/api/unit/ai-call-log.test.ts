// `AI_CALL_LOG`: one JSON line per AI call, whatever the provider.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseSearchOutput,
  parseTalkStartOutput,
} from "../../../packages/game-engine/src/ai-contracts.ts";
import { createAIProviderFromProfile } from "../../../packages/game-engine/src/ai-provider.ts";

const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude-cli.mjs", import.meta.url));

let scratch: string;
let logFile: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-call-log-"));
  logFile = path.join(scratch, "run", "ai-calls.jsonl");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(scratch, { recursive: true, force: true });
});

function loggedLines(): Array<Record<string, unknown>> {
  return fs.readFileSync(logFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

const METADATA = {
  request_id: "req-1",
  endpoint: "game-search",
  action: "search",
  game_id: "game-1",
};

const SEARCH_REQUEST = {
  role: "search" as const,
  prompt: "Search prompt",
  context: { search_context: { location_name: "Kitchen", next_clue: null } },
  parse: parseSearchOutput,
  metadata: METADATA,
};

describe("AI call log", () => {
  it("writes nothing when AI_CALL_LOG is unset", async () => {
    const provider = createAIProviderFromProfile(
      { provider: "mock", model: "mock/runtime-default" },
      { env: {} },
    );

    await provider.generateRoleOutput(SEARCH_REQUEST);

    expect(fs.existsSync(logFile)).toBe(false);
  });

  it("records a role call: what was asked, what came back, and where it came from", async () => {
    const provider = createAIProviderFromProfile(
      { provider: "mock", model: "mock/runtime-default" },
      { env: { AI_CALL_LOG: logFile } },
    );

    const output = await provider.generateRoleOutput(SEARCH_REQUEST);

    const [line] = loggedLines();
    expect(line).toMatchObject({
      game_id: "game-1",
      endpoint: "game-search",
      action: "search",
      request_id: "req-1",
      role: "search",
      provider: "mock",
      model: "mock/runtime-default",
      resolved_model: "mock/runtime-default",
      prompt: "Search prompt",
      context: SEARCH_REQUEST.context,
      output: {
        narration: output.narration,
        revealed_clue_id: null,
        costs_turn: true,
        input_understood: true,
      },
      parsed_ok: true,
      error: null,
      input_tokens: null,
      cost_usd: null,
    });
    expect(typeof line.latency_ms).toBe("number");
  });

  it("keeps the raw output when the parser rejects it, and still fails the call", async () => {
    const provider = createAIProviderFromProfile(
      { provider: "mock", model: "mock/runtime-default" },
      { env: { AI_CALL_LOG: logFile } },
    );

    await expect(
      provider.generateRoleOutput({
        ...SEARCH_REQUEST,
        // A search payload read as talk_start's contract parses fine, so use a
        // parser that always refuses to stand in for a contract violation.
        parse: () => parseTalkStartOutput({ narration: "" }),
      }),
    ).rejects.toThrow("narration");

    const [line] = loggedLines();
    expect(line.parsed_ok).toBe(false);
    expect(line.error).toContain("narration");
    expect(line.output).toMatchObject({ revealed_clue_id: null });
  });

  it("records plain narration calls", async () => {
    const provider = createAIProviderFromProfile(
      { provider: "mock", model: "mock/runtime-default" },
      { env: { AI_CALL_LOG: logFile } },
    );

    const narration = await provider.generateNarration("Describe the kitchen.", METADATA);

    expect(loggedLines()).toEqual([
      expect.objectContaining({
        role: "narration",
        prompt: "Describe the kitchen.",
        context: null,
        output: narration,
        parsed_ok: true,
      }),
    ]);
  });

  it("adds tokens, cost and attempts where the provider reports them", async () => {
    vi.stubEnv("FAKE_CLAUDE_BEHAVIOUR", "ok");
    vi.stubEnv(
      "FAKE_CLAUDE_OUTPUT",
      JSON.stringify({
        narration: "Dust.",
        revealed_clue_id: null,
        costs_turn: true,
        input_understood: true,
      }),
    );
    const provider = createAIProviderFromProfile(
      { provider: "claude-cli", model: "sonnet" },
      { env: { AI_CALL_LOG: logFile, CLAUDE_CLI_PATH: FAKE_CLAUDE } },
    );

    await provider.generateRoleOutput(SEARCH_REQUEST);

    expect(loggedLines()[0]).toMatchObject({
      provider: "claude-cli",
      model: "sonnet",
      resolved_model: "claude-sonnet-test-1",
      input_tokens: 1115,
      output_tokens: 43,
      cost_usd: 0.0123,
      attempts: 1,
    });
  });
});
