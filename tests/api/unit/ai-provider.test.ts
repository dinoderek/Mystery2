import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAIRequestMetadata,
  getAIProvider,
  isLiveAIEnabled,
  resolveAIProfile,
} from "../../../supabase/functions/_shared/ai-provider.ts";
import {
  parseSearchOutput,
  parseAccusationJudgeOutput,
  parseTalkStartOutput,
} from "../../../supabase/functions/_shared/ai-contracts.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ai-provider runtime resolution", () => {
  it("fails when required env is missing", () => {
    expect(() => resolveAIProfile({})).toThrow("AI_PROVIDER");
    expect(() => resolveAIProfile({ AI_PROVIDER: "mock" })).toThrow("AI_MODEL");
  });

  it("resolves provider/model from env", () => {
    const profile = resolveAIProfile({
      AI_PROVIDER: "openrouter",
      AI_MODEL: "test/cost-model",
    });

    expect(profile).toEqual({
      provider: "openrouter",
      model: "test/cost-model",
    });
  });

  it("parses live toggle", () => {
    expect(isLiveAIEnabled({ AI_LIVE: "1" })).toBe(true);
    expect(isLiveAIEnabled({ AI_LIVE: "false" })).toBe(false);
  });
});

describe("ai-provider openrouter retry behavior", () => {
  it("retries transient provider errors and eventually succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "rate limited" }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "{\"narration\":\"Recovered\"}" } }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    globalThis.fetch = fetchMock as typeof fetch;

    const provider = getAIProvider({
      AI_PROVIDER: "openrouter",
      AI_MODEL: "test/openrouter-model",
      OPENROUTER_API_KEY: "test-key",
      AI_OPENROUTER_MAX_ATTEMPTS: "3",
      AI_OPENROUTER_BASE_BACKOFF_MS: "1",
      AI_OPENROUTER_TIMEOUT_MS: "1000",
    });

    const output = await provider.generateRoleOutput({
      role: "search",
      prompt: "Search prompt",
      context: { location_name: "Kitchen" },
      parse: parseSearchOutput,
    });

    expect(output.narration).toBe("Recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps abort failures to retriable timeout errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      new DOMException("Aborted", "AbortError"),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = getAIProvider({
      AI_PROVIDER: "openrouter",
      AI_MODEL: "test/openrouter-model",
      OPENROUTER_API_KEY: "test-key",
      AI_OPENROUTER_MAX_ATTEMPTS: "1",
      AI_OPENROUTER_TIMEOUT_MS: "1000",
    });

    await expect(
      provider.generateNarration("Hello narrator"),
    ).rejects.toMatchObject({
      name: "RetriableAIError",
      details: {
        retriable: true,
        code: "OPENROUTER_TIMEOUT",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("ai-provider request metadata", () => {
  it("preserves incoming request ids", () => {
    const req = new Request("http://localhost/test", {
      headers: { "x-request-id": "req-123" },
    });

    const metadata = createAIRequestMetadata(req, {
      endpoint: "game-ask",
      action: "ask",
      game_id: "game-1",
    });
    expect(metadata).toEqual({
      request_id: "req-123",
      endpoint: "game-ask",
      action: "ask",
      game_id: "game-1",
    });
  });

  it("generates request ids when missing", () => {
    const req = new Request("http://localhost/test");
    const metadata = createAIRequestMetadata(req, {
      endpoint: "game-search",
      action: "search",
    });

    expect(metadata.endpoint).toBe("game-search");
    expect(metadata.action).toBe("search");
    expect(metadata.request_id.length).toBeGreaterThan(0);
  });
});

describe("ai-provider mock role output", () => {
  it("returns parseable role payloads", async () => {
    const provider = getAIProvider({
      AI_PROVIDER: "mock",
      AI_MODEL: "mock/default",
    });
    const output = await provider.generateRoleOutput({
      role: "talk_start",
      prompt: "prompt",
      context: { character_name: "Alice", location_name: "Kitchen" },
      parse: parseTalkStartOutput,
    });

    expect(output.narration).toContain("[Mock]");
  });

  it("supports accusation continue and resolved rounds", async () => {
    const provider = getAIProvider({
      AI_PROVIDER: "mock",
      AI_MODEL: "mock/default",
    });

    const firstRound = await provider.generateRoleOutput({
      role: "accusation_judge",
      prompt: "prompt",
      context: {
        player_input: "I accuse Alice because she had crumbs on her sleeves.",
        round: 0,
        character_truth: { Alice: true, Bob: false },
        shared_mystery_context: {
          character_names: ["Alice Smith", "Bob Jones"],
        },
      },
      parse: parseAccusationJudgeOutput,
    });
    expect(firstRound.accusation_resolution).toBe("continue");
    expect(firstRound.follow_up_prompt).toBeTruthy();
    expect(firstRound.inferred_accused_character).toBe("Alice");

    const secondRound = await provider.generateRoleOutput({
      role: "accusation_judge",
      prompt: "prompt",
      context: {
        player_input: "Alice had motive and opportunity.",
        round: 1,
        character_truth: { Alice: true, Bob: false },
        shared_mystery_context: {
          character_names: ["Alice Smith", "Bob Jones"],
        },
      },
      parse: parseAccusationJudgeOutput,
    });
    expect(secondRound.accusation_resolution).toBe("win");
    expect(secondRound.follow_up_prompt).toBeNull();
    expect(secondRound.inferred_accused_character).toBe("Alice");
  });

  it("generates search narration from location context only", async () => {
    const provider = getAIProvider({
      AI_PROVIDER: "mock",
      AI_MODEL: "mock/default",
    });

    const output = await provider.generateRoleOutput({
      role: "search",
      prompt: "prompt",
      context: { location_name: "Kitchen" },
      parse: parseSearchOutput,
    });

    expect(output.narration).toContain("Kitchen");
  });

  it("fails parsing when output shape is invalid", async () => {
    const provider = getAIProvider({
      AI_PROVIDER: "mock",
      AI_MODEL: "mock/default",
    });

    await expect(
      provider.generateRoleOutput({
        role: "talk_start",
        prompt: "prompt",
        context: { character_name: "Alice", location_name: "Kitchen" },
        parse: () => {
          throw new Error("validation failed");
        },
      }),
    ).rejects.toThrow("validation failed");
  });

  it("fails mock generation when required context is missing", async () => {
    const provider = getAIProvider({
      AI_PROVIDER: "mock",
      AI_MODEL: "mock/default",
    });

    await expect(
      provider.generateRoleOutput({
        role: "talk_start",
        prompt: "prompt",
        context: {},
        parse: parseTalkStartOutput,
      }),
    ).rejects.toThrow("character_name");
  });
});
