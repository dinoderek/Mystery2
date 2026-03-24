import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAIProviderFromProfile,
  createAIRequestMetadata,
  isLiveAIEnabled,
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

describe("ai-provider runtime configuration", () => {
  it("parses live toggle", () => {
    expect(isLiveAIEnabled({ AI_LIVE: "1" })).toBe(true);
    expect(isLiveAIEnabled({ AI_LIVE: "false" })).toBe(false);
  });

  it("builds provider from explicit runtime profile", async () => {
    const provider = createAIProviderFromProfile(
      { provider: "mock", model: "mock/runtime-default" },
    );

    const output = await provider.generateRoleOutput({
      role: "search",
      prompt: "Search prompt",
      context: { search_context: { location_name: "Kitchen", next_clue: null } },
      parse: parseSearchOutput,
    });
    expect(output.narration).toContain("Kitchen");
  });

  it("requires openrouter key from profile options", () => {
    expect(() =>
      createAIProviderFromProfile({
        provider: "openrouter",
        model: "test/openrouter-model",
      })
    ).toThrow("openrouter_api_key");
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

    const provider = createAIProviderFromProfile(
      { provider: "openrouter", model: "test/openrouter-model" },
      {
        openrouterApiKey: "test-key",
        env: {
          AI_OPENROUTER_MAX_ATTEMPTS: "3",
          AI_OPENROUTER_BASE_BACKOFF_MS: "1",
          AI_OPENROUTER_TIMEOUT_MS: "1000",
        },
      },
    );

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

    const provider = createAIProviderFromProfile(
      { provider: "openrouter", model: "test/openrouter-model" },
      {
        openrouterApiKey: "test-key",
        env: {
          AI_OPENROUTER_MAX_ATTEMPTS: "1",
          AI_OPENROUTER_TIMEOUT_MS: "1000",
        },
      },
    );

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
    const provider = createAIProviderFromProfile({
      provider: "mock",
      model: "mock/default",
    });
    const output = await provider.generateRoleOutput({
      role: "talk_start",
      prompt: "prompt",
      context: {
        talk_context: {
          active_character: {
            first_name: "Alice",
            sex: "female",
          },
          active_location_name: "Kitchen",
        },
      },
      parse: parseTalkStartOutput,
    });

    expect(output.narration).toContain("[Mock]");
    expect(output.narration).toContain("Alice");
    expect(output.narration).toContain("she");
  });

  it("supports accusation continue and resolved rounds", async () => {
    const provider = createAIProviderFromProfile({
      provider: "mock",
      model: "mock/default",
    });

    const firstRound = await provider.generateRoleOutput({
      role: "accusation_judge",
      prompt: "prompt",
      context: {
        player_input: "I accuse Alice because she had crumbs on her sleeves.",
        accusation_judge_context: {
          round: 0,
          full_blueprint: {
            world: {
              characters: [
                { first_name: "Alice", is_culprit: true },
                { first_name: "Bob", is_culprit: false },
              ],
            },
          },
        },
      },
      parse: parseAccusationJudgeOutput,
    });
    expect(firstRound.accusation_resolution).toBe("continue");
    expect(firstRound.follow_up_prompt).toBeTruthy();

    const secondRound = await provider.generateRoleOutput({
      role: "accusation_judge",
      prompt: "prompt",
      context: {
        player_input: "Alice had motive and opportunity.",
        accusation_judge_context: {
          round: 1,
          full_blueprint: {
            world: {
              characters: [
                { first_name: "Alice", is_culprit: true },
                { first_name: "Bob", is_culprit: false },
              ],
            },
          },
        },
      },
      parse: parseAccusationJudgeOutput,
    });
    expect(secondRound.accusation_resolution).toBe("win");
    expect(secondRound.follow_up_prompt).toBeNull();
  });

  it("generates search narration from location context only", async () => {
    const provider = createAIProviderFromProfile({
      provider: "mock",
      model: "mock/default",
    });

    const output = await provider.generateRoleOutput({
      role: "search",
      prompt: "prompt",
      context: {
        search_context: {
          location_name: "Kitchen",
          next_clue: { id: "clue-crumb", text: "A crumb on the floor.", role: "direct_evidence" },
        },
      },
      parse: parseSearchOutput,
    });

    expect(output.narration).toContain("Kitchen");
    expect(output.narration).toContain("A crumb on the floor.");
  });

  it("fails parsing when output shape is invalid", async () => {
    const provider = createAIProviderFromProfile({
      provider: "mock",
      model: "mock/default",
    });

    await expect(
      provider.generateRoleOutput({
        role: "talk_start",
        prompt: "prompt",
        context: {
          talk_context: {
            active_character: { first_name: "Alice" },
            active_location_name: "Kitchen",
          },
        },
        parse: () => {
          throw new Error("validation failed");
        },
      }),
    ).rejects.toThrow("validation failed");
  });

  it("fails mock generation when required context is missing", async () => {
    const provider = createAIProviderFromProfile({
      provider: "mock",
      model: "mock/default",
    });

    await expect(
      provider.generateRoleOutput({
        role: "talk_start",
        prompt: "prompt",
        context: {},
        parse: parseTalkStartOutput,
      }),
    ).rejects.toThrow("talk_start");
  });
});
