import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAIProviderFromProfile,
  createAIRequestMetadata,
  isLiveAIEnabled,
} from "../../../packages/game-engine/src/ai-provider.ts";
import { buildGameMovePrompt } from "../../../packages/game-engine/src/ai-prompts.ts";
import {
  type AIRoleName,
  parseAccusationStartOutput,
  parseGraphSearchOutput,
  parseTalkEndOutput,
} from "../../../packages/game-engine/src/ai-contracts.ts";

/** A search whose outcome the engine knows, as the mock reads it. */
function knownSearch(finds: { id: string; text: string } | null) {
  return {
    graph_search_context: {
      location_name: "Kitchen",
      search_query: null,
      outcome: { kind: "known", spot: null, finds },
    },
  };
}

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
      role: "graph_search",
      prompt: "Search prompt",
      context: knownSearch(null),
      parse: parseGraphSearchOutput,
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
      role: "graph_search",
      prompt: "Search prompt",
      context: { location_name: "Kitchen" },
      parse: parseGraphSearchOutput,
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

describe("ai-provider resolved model", () => {
  it("mock provider resolves to the configured profile model", () => {
    const provider = createAIProviderFromProfile({
      provider: "mock",
      model: "mock/runtime-default",
    });
    expect(provider.resolvedModel).toBe("mock/runtime-default");
  });

  it("openrouter provider reports the model returned by the API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "anthropic/claude-actual",
          choices: [{ message: { content: "Narrated" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = createAIProviderFromProfile(
      { provider: "openrouter", model: "anthropic/claude-requested" },
      { openrouterApiKey: "test-key", env: { AI_OPENROUTER_MAX_ATTEMPTS: "1" } },
    );

    // Before any call, falls back to the configured model.
    expect(provider.resolvedModel).toBe("anthropic/claude-requested");

    await provider.generateNarration("Hello narrator");

    // After a successful call, reflects the model the API actually served.
    expect(provider.resolvedModel).toBe("anthropic/claude-actual");
  });

  it("openrouter provider keeps the configured model when the response omits one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "Narrated" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = createAIProviderFromProfile(
      { provider: "openrouter", model: "anthropic/claude-requested" },
      { openrouterApiKey: "test-key", env: { AI_OPENROUTER_MAX_ATTEMPTS: "1" } },
    );

    await provider.generateNarration("Hello narrator");
    expect(provider.resolvedModel).toBe("anthropic/claude-requested");
  });
});

describe("ai-provider request metadata", () => {
  it("preserves incoming request ids", () => {
    const req = new Request("http://localhost/test", {
      headers: { "x-request-id": "req-123" },
    });

    const metadata = createAIRequestMetadata(req, {
      endpoint: "game-turn",
      action: "ask",
      game_id: "game-1",
    });
    expect(metadata).toEqual({
      request_id: "req-123",
      endpoint: "game-turn",
      action: "ask",
      game_id: "game-1",
    });
  });

  it("generates request ids when missing", () => {
    const req = new Request("http://localhost/test");
    const metadata = createAIRequestMetadata(req, {
      endpoint: "game-turn",
      action: "search",
    });

    expect(metadata.endpoint).toBe("game-turn");
    expect(metadata.action).toBe("search");
    expect(metadata.request_id.length).toBeGreaterThan(0);
  });
});

describe("ai-provider mock role output", () => {
  const provider = () => createAIProviderFromProfile({ provider: "mock", model: "mock/default" });

  it("returns parseable role payloads", async () => {
    const output = await provider().generateRoleOutput({
      role: "talk_end",
      prompt: "prompt",
      context: { talk_context: { active_character: { first_name: "Alice" } } },
      parse: parseTalkEndOutput,
    });

    expect(output.narration).toBe("[Mock] You say goodbye to Alice and look around again.");
  });

  it("frames the accusation, urgently when time is up", async () => {
    const open = await provider().generateRoleOutput({
      role: "accusation_start",
      prompt: "prompt",
      context: { forced_by_timeout: false },
      parse: parseAccusationStartOutput,
    });
    expect(open.narration).toContain("The final accusation begins.");
    const forced = await provider().generateRoleOutput({
      role: "accusation_start",
      prompt: "prompt",
      context: { forced_by_timeout: true },
      parse: parseAccusationStartOutput,
    });
    expect(forced.narration).toContain("Time is up.");
  });

  it("generates search narration from the known outcome only", async () => {
    const output = await provider().generateRoleOutput({
      role: "graph_search",
      prompt: "prompt",
      context: knownSearch({ id: "clue-crumb", text: "A crumb on the floor." }),
      parse: parseGraphSearchOutput,
    });

    expect(output.narration).toContain("Kitchen");
    expect(output.narration).toContain("A crumb on the floor.");
    expect(output.revealed_clue_id).toBe("clue-crumb");
    expect(output.notebook.map((entry) => entry.id)).toEqual(["clue-crumb"]);
  });

  it("fails parsing when output shape is invalid", async () => {
    await expect(
      provider().generateRoleOutput({
        role: "talk_end",
        prompt: "prompt",
        context: { talk_context: { active_character: { first_name: "Alice" } } },
        parse: () => {
          throw new Error("validation failed");
        },
      }),
    ).rejects.toThrow("validation failed");
  });

  it("fails mock generation when required context is missing", async () => {
    await expect(
      provider().generateRoleOutput({
        role: "talk_end",
        prompt: "prompt",
        context: {},
        parse: parseTalkEndOutput,
      }),
    ).rejects.toThrow("talk_end");
  });

  it.each(["talk_start", "talk_conversation", "search", "accusation_judge"])(
    "has no handler for the retired %s role",
    async (role) => {
      const produced = await provider()
        .generateRoleOutput({ role: role as AIRoleName, prompt: "prompt", context: {}, parse: (value) => value })
        .catch(() => undefined);
      expect(produced).toBeUndefined();
    },
  );
});

describe("mock arrival narration", () => {
  const provider = () =>
    createAIProviderFromProfile({ provider: "mock", model: "mock/default" });
  const arrivalPrompt = (characters: unknown[]) =>
    buildGameMovePrompt({
      target_age: 7,
      destination_name: "Leaf-Lab",
      has_visited_before: false,
      destination_characters_json: JSON.stringify(characters),
      destination_facts: ["A lab full of leaves."],
    });

  it("names the place, states its facts, and names who is there and nothing else of them", async () => {
    const narration = await provider().generateNarration(
      arrivalPrompt([{ id: "char-eva", first_name: "Eva", personality: "prickly" }]),
    );
    expect(narration).toBe("[Mock] You arrive at Leaf-Lab. A lab full of leaves. Eva is here.");
  });

  it("describes an empty place without anyone in it", async () => {
    expect(await provider().generateNarration(arrivalPrompt([]))).toBe(
      "[Mock] You arrive at Leaf-Lab. A lab full of leaves.",
    );
  });

  it("keeps the generic narration for any other prompt", async () => {
    expect(await provider().generateNarration("Open the case.")).toContain(
      "[Mock] Narration for: Open the case.",
    );
  });
});
