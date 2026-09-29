// The claude-cli provider, driven against a fake `claude` (fixtures/
// fake-claude-cli.mjs) so no test calls a real model. These pin what reaches
// the CLI — the isolation flags, the schema, the message on stdin, a working
// directory outside the repo — and how its replies and failures come back.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseAccusationJudgeOutput,
  parseTalkConversationOutput,
  roleOutputJsonSchema,
} from "../../../packages/game-engine/src/ai-contracts.ts";
import {
  type AIProvider,
  createAIProviderFromProfile,
} from "../../../packages/game-engine/src/ai-provider.ts";
import { RetriableAIError } from "../../../packages/game-engine/src/errors.ts";

const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude-cli.mjs", import.meta.url));

let scratch: string;
let recordFile: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-claude-cli-"));
  recordFile = path.join(scratch, "calls.jsonl");
  vi.stubEnv("FAKE_CLAUDE_RECORD", recordFile);
  vi.stubEnv("FAKE_CLAUDE_COUNTER", path.join(scratch, "counter"));
  vi.stubEnv("FAKE_CLAUDE_BEHAVIOUR", "ok");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(scratch, { recursive: true, force: true });
});

function provider(env: Record<string, string> = {}): AIProvider {
  return createAIProviderFromProfile(
    { provider: "claude-cli", model: "sonnet" },
    {
      env: {
        CLAUDE_CLI_PATH: FAKE_CLAUDE,
        AI_CLAUDE_CLI_BASE_BACKOFF_MS: "1",
        ...env,
      },
    },
  );
}

function recordedCalls(): Array<{ args: string[]; stdin: string; cwd: string }> {
  if (!fs.existsSync(recordFile)) return [];
  return fs.readFileSync(recordFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

const TALK_REQUEST = {
  role: "talk_conversation" as const,
  prompt: "Answer the investigator in character.",
  context: { talk_context: { active_character: { first_name: "Sam" } } },
  parse: parseTalkConversationOutput,
};

describe("claude-cli provider requests", () => {
  it("asks for a role's output with its schema, the role message on stdin, outside the repo", async () => {
    vi.stubEnv(
      "FAKE_CLAUDE_OUTPUT",
      JSON.stringify({
        narration: "I saw a fox.",
        revealed_clue_ids: ["clue-fox"],
        revealed_off_script: [],
        input_understood: true,
      }),
    );

    const output = await provider().generateRoleOutput(TALK_REQUEST);

    expect(output).toEqual({
      narration: "I saw a fox.",
      revealed_clue_ids: ["clue-fox"],
      revealed_off_script: [],
      input_understood: true,
    });

    const [call] = recordedCalls();
    expect(call.args.slice(0, 5)).toEqual(["--print", "--model", "sonnet", "--output-format", "json"]);
    expect(flagValue(call.args, "--system-prompt")).toBe(
      'You are a strict JSON API for role "talk_conversation". Output JSON only.',
    );
    expect(flagValue(call.args, "--tools")).toBe("");
    expect(flagValue(call.args, "--setting-sources")).toBe("");
    expect(call.args).toContain("--strict-mcp-config");
    expect(call.args).toContain("--no-session-persistence");
    expect(call.args).not.toContain("--append-system-prompt");
    expect(JSON.parse(flagValue(call.args, "--json-schema")!)).toEqual(
      roleOutputJsonSchema("talk_conversation"),
    );
    expect(JSON.parse(call.stdin)).toEqual({
      prompt: TALK_REQUEST.prompt,
      context: TALK_REQUEST.context,
    });
    expect(fs.realpathSync(call.cwd)).toBe(fs.realpathSync(os.tmpdir()));
  });

  it("asks for narration as plain text, with no schema", async () => {
    const narration = await provider().generateNarration("Describe the arrival.");

    expect(narration).toBe("The fake narrator speaks.");
    const [call] = recordedCalls();
    expect(flagValue(call.args, "--system-prompt")).toBe(
      "You are the narrator for a kids mystery game. Return plain text only.",
    );
    expect(call.args).not.toContain("--json-schema");
    expect(call.stdin).toBe("Describe the arrival.");
  });

  it("reports the model that answered and what the call cost", async () => {
    const cli = provider();
    expect(cli.resolvedModel).toBe("sonnet");

    await cli.generateRoleOutput(TALK_REQUEST);

    expect(cli.resolvedModel).toBe("claude-sonnet-test-1");
    expect(cli.lastUsage).toEqual({
      input_tokens: 1015,
      output_tokens: 42,
      cost_usd: 0.0123,
      attempts: 1,
    });
  });
});

describe("claude-cli provider failures", () => {
  async function expectRetriable(promise: Promise<unknown>, code: string) {
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(RetriableAIError);
    expect((error as RetriableAIError).details.code).toBe(code);
  }

  it("retries a failed run and succeeds", async () => {
    vi.stubEnv("FAKE_CLAUDE_BEHAVIOUR", "fail-once");
    const cli = provider();

    await cli.generateRoleOutput(TALK_REQUEST);

    expect(recordedCalls()).toHaveLength(2);
    expect(cli.lastUsage?.attempts).toBe(2);
  });

  it("gives up after the configured attempts with a retriable error", async () => {
    vi.stubEnv("FAKE_CLAUDE_BEHAVIOUR", "is-error");

    await expectRetriable(
      provider({ AI_CLAUDE_CLI_MAX_ATTEMPTS: "2" }).generateRoleOutput(TALK_REQUEST),
      "CLAUDE_CLI_ERROR",
    );
    expect(recordedCalls()).toHaveLength(2);
  });

  it("reports a crash, output that is not JSON, and a reply with no structured output", async () => {
    const once = { AI_CLAUDE_CLI_MAX_ATTEMPTS: "1" };

    vi.stubEnv("FAKE_CLAUDE_BEHAVIOUR", "crash");
    await expectRetriable(provider(once).generateRoleOutput(TALK_REQUEST), "CLAUDE_CLI_FAILED");

    vi.stubEnv("FAKE_CLAUDE_BEHAVIOUR", "not-json");
    await expectRetriable(provider(once).generateRoleOutput(TALK_REQUEST), "CLAUDE_CLI_BAD_OUTPUT");

    vi.stubEnv("FAKE_CLAUDE_BEHAVIOUR", "no-output");
    await expectRetriable(
      provider(once).generateRoleOutput(TALK_REQUEST),
      "CLAUDE_CLI_NO_STRUCTURED_OUTPUT",
    );
    await expectRetriable(provider(once).generateNarration("Hi"), "CLAUDE_CLI_EMPTY_RESULT");
  });

  it("kills a run that outlasts the timeout", async () => {
    vi.stubEnv("FAKE_CLAUDE_BEHAVIOUR", "hang");

    await expectRetriable(
      provider({ AI_CLAUDE_CLI_TIMEOUT_MS: "300", AI_CLAUDE_CLI_MAX_ATTEMPTS: "1" })
        .generateRoleOutput(TALK_REQUEST),
      "CLAUDE_CLI_TIMEOUT",
    );
  });

  it("does not retry a reply its parser rejects", async () => {
    vi.stubEnv(
      "FAKE_CLAUDE_OUTPUT",
      JSON.stringify({
        narration: "Hmm.",
        accusation_resolution: "continue",
        follow_up_prompt: null,
      }),
    );

    const error = await provider()
      .generateRoleOutput({
        role: "accusation_judge",
        prompt: "Judge the accusation.",
        context: {},
        parse: parseAccusationJudgeOutput,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RetriableAIError);
    expect(String(error)).toContain("follow_up_prompt");
    expect(recordedCalls()).toHaveLength(1);
  });

  it("says so when the CLI cannot be run at all", async () => {
    await expect(
      provider({ CLAUDE_CLI_PATH: path.join(scratch, "no-such-claude") })
        .generateNarration("Hi"),
    ).rejects.toThrow("Could not run the claude CLI");
  });
});
