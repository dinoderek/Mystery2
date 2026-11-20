import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAIProviderFromProfile,
  createAIRequestMetadata,
  isLiveAIEnabled,
} from "../../../packages/game-engine/src/ai-provider.ts";
import { buildGameMovePrompt } from "../../../packages/game-engine/src/ai-prompts.ts";
import {
  parseSearchOutput,
  parseAccusationJudgeOutput,
  parseTalkConversationOutput,
  parseTalkStartOutput,
} from "../../../packages/game-engine/src/ai-contracts.ts";

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
    expect(firstRound).not.toHaveProperty("follow_up_prompt");

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
    expect(secondRound).not.toHaveProperty("follow_up_prompt");
  });

  it("rejects a wrong accusation with encouragement, losing only from round 3", async () => {
    const provider = createAIProviderFromProfile({
      provider: "mock",
      model: "mock/default",
    });

    const judgeContext = (round: number) => ({
      player_input: "It was Bob, I'm sure of it.",
      accusation_judge_context: {
        round,
        full_blueprint: {
          world: {
            characters: [
              { first_name: "Alice", is_culprit: true },
              { first_name: "Bob", is_culprit: false },
            ],
          },
        },
      },
    });

    // Early wrong accusations are rejected with an invitation to try again.
    const earlyRound = await provider.generateRoleOutput({
      role: "accusation_judge",
      prompt: "prompt",
      context: judgeContext(1),
      parse: parseAccusationJudgeOutput,
    });
    expect(earlyRound.accusation_resolution).toBe("continue");
    expect(earlyRound).not.toHaveProperty("follow_up_prompt");
    expect(earlyRound.narration).toContain("have another go");

    // From round 3 a still-wrong accusation finally resolves to lose.
    const finalRound = await provider.generateRoleOutput({
      role: "accusation_judge",
      prompt: "prompt",
      context: judgeContext(3),
      parse: parseAccusationJudgeOutput,
    });
    expect(finalRound.accusation_resolution).toBe("lose");
    expect(finalRound).not.toHaveProperty("follow_up_prompt");
  });

  it("points a rejection's closing question at an unfinished solution path", async () => {
    const provider = createAIProviderFromProfile({ provider: "mock", model: "mock/default" });
    const round = await provider.generateRoleOutput({
      role: "accusation_judge",
      prompt: "prompt",
      context: {
        player_input: "It was Bob.",
        accusation_judge_context: {
          round: 1,
          full_blueprint: {
            world: { characters: [{ first_name: "Alice", is_culprit: true }, { first_name: "Bob" }] },
          },
          path_coverage: [{ kind: "solution", summary: "the missing cookies", missing_clue_ids: ["c1"] }],
        },
      },
      parse: parseAccusationJudgeOutput,
    });
    expect(round.accusation_resolution).toBe("continue");
    expect(round.narration).toContain("There is more to know about the missing cookies.");
    expect(round.narration).toMatch(/\?$/);
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
          next_clue: { id: "clue-crumb", text: "A crumb on the floor." },
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

describe("mock talk_conversation clue gating", () => {
  const provider = createAIProviderFromProfile({ provider: "mock", model: "mock/default" });
  const askWith = (clues: unknown[], playerInput: string) =>
    provider.generateRoleOutput({
      role: "talk_conversation",
      prompt: "prompt",
      context: {
        player_input: playerInput,
        talk_context: { active_character: { first_name: "Alice", clues } },
      },
      parse: parseTalkConversationOutput,
    });

  it("reveals the first unlocked clue", async () => {
    const out = await askWith(
      [
        { id: "locked", text: "secret", player_can_use_prerequisites: false },
        { id: "open", text: "open clue", player_can_use_prerequisites: true },
      ],
      "What did you see?",
    );
    expect(out.revealed_clue_ids).toEqual(["open"]);
    expect(out.revealed_off_script).toEqual([]);
  });

  it("skips clues the player already holds", async () => {
    const out = await askWith(
      [
        { id: "known", text: "old news", player_can_use_prerequisites: true, known_to_player: true },
        { id: "open", text: "open clue", player_can_use_prerequisites: true, known_to_player: false },
      ],
      "Where exactly did you find it?",
    );
    expect(out.revealed_clue_ids).toEqual(["open"]);
  });

  it("reveals nothing once the player holds every clue", async () => {
    const out = await askWith(
      [
        { id: "known", text: "old news", player_can_use_prerequisites: true, known_to_player: true },
        { id: "granted", text: "secret", player_can_use_prerequisites: false, known_to_player: true },
      ],
      "Aha — I bet you know more!",
    );
    expect(out.revealed_clue_ids).toEqual([]);
    expect(out.revealed_off_script).toEqual([]);
  });

  it("withholds clues whose prerequisites are not met", async () => {
    const out = await askWith(
      [{ id: "locked", text: "secret", player_can_use_prerequisites: false }],
      "What did you see?",
    );
    expect(out.revealed_clue_ids).toEqual([]);
  });

  it("grants a locked clue off-script on a brilliance sentinel", async () => {
    const out = await askWith(
      [{ id: "locked", text: "secret", player_can_use_prerequisites: false }],
      "Aha — I bet you were at the dock!",
    );
    expect(out.revealed_clue_ids).toEqual(["locked"]);
    expect(out.revealed_off_script).toEqual(["locked"]);
  });
});

describe("mock talk_conversation use and commitments", () => {
  const provider = createAIProviderFromProfile({ provider: "mock", model: "mock/default" });
  const askWith = (activeCharacter: Record<string, unknown>, playerInput: string) =>
    provider.generateRoleOutput({
      role: "talk_conversation",
      prompt: "prompt",
      context: {
        player_input: playerInput,
        talk_context: { active_character: { first_name: "Alice", clues: [], ...activeCharacter } },
      },
      parse: parseTalkConversationOutput,
    });

  it("reports a gate clue the line names as used, quoting the line", async () => {
    const out = await askWith(
      { gate_clues: [{ id: "clue-crumb", held: true }, { id: "clue-wrapper", held: false }] },
      "This clue-crumb says you were snacking.",
    );
    expect(out.used_clue_ids).toEqual(["clue-crumb"]);
    expect(out.used_quote).toBe("This clue-crumb says you were snacking.");
  });

  it("reports no use when the line names no gate clue", async () => {
    const out = await askWith({ gate_clues: [{ id: "clue-crumb", held: true }] }, "Were you snacking?");
    expect(out.used_clue_ids).toEqual([]);
    expect(out.used_quote).toBeNull();
  });

  it("records a denial when asked whether they did something", async () => {
    const out = await askWith({}, "Did you eat the cookies?");
    expect(out.new_commitments).toEqual(["denies: eat the cookies"]);
  });

  it.each([
    { clues: [], input: "Tell me again." },
    { clues: [{ id: "open", text: "An open clue." }], input: "What did you see?" },
    { clues: [{ id: "locked", text: "A secret clue.", player_can_use_prerequisites: false }], input: "Aha, I bet you know more!" },
  ])("keeps internal story annotations out of dialogue: $input", async ({ clues, input }) => {
    const output = await askWith({
      clues,
      stated_alibi: "I was reading.",
      state: { current_story: ["I was reading.", "Admits one snack."] },
    }, input);
    expect(output.narration).not.toContain("Keeps to:");
    expect(output.narration).not.toContain("Admits one snack.");
    expect(output.narration).not.toContain("I was reading.");
  });
});

describe("mock arrival narration", () => {
  const provider = () =>
    createAIProviderFromProfile({ provider: "mock", model: "mock/default" });
  const arrivalPrompt = (characters: unknown[]) =>
    buildGameMovePrompt({
      target_age: 7,
      destination_name: "Leaf-Lab",
      destination_description: "A lab full of leaves.",
      has_visited_before: false,
      destination_characters_json: JSON.stringify(characters),
    });

  it("names the place and who is there, and nothing of their manner", async () => {
    const narration = await provider().generateNarration(
      arrivalPrompt([
        {
          id: "char-eva",
          first_name: "Eva",
          personality: "prickly",
          manner: ["keeps attention away from herself"],
          tells: ["She hums."],
        },
      ]),
    );
    expect(narration).toBe("[Mock] You arrive at Leaf-Lab. Eva is here.");
  });

  it("describes an empty place without anyone in it", async () => {
    expect(await provider().generateNarration(arrivalPrompt([]))).toBe(
      "[Mock] You arrive at Leaf-Lab.",
    );
  });

  it("keeps the generic narration for any other prompt", async () => {
    expect(await provider().generateNarration("Open the case.")).toContain(
      "[Mock] Narration for: Open the case.",
    );
  });
});

describe("mock greeting tells", () => {
  const greet = async (tells: unknown[]) => {
    const provider = createAIProviderFromProfile({ provider: "mock", model: "mock/default" });
    const output = await provider.generateRoleOutput({
      role: "talk_start",
      prompt: "prompt",
      context: {
        talk_context: {
          active_character: { first_name: "Eva", sex: "female", appearance: "neat", tells },
          active_location_name: "Leaf-Lab",
        },
      },
      parse: parseTalkStartOutput,
    });
    return output.narration;
  };

  it("shows an always tell, never one the investigator has to earn", async () => {
    const narration = await greet([
      { id: "t1", text: "tail puffs up", trigger: { kind: "clue", clue_ids: ["c1"] } },
      { id: "t2", text: "hums a nervous tune", trigger: { kind: "condition", condition: "x" } },
      { id: "t3", text: "taps her tiny tools", trigger: { kind: "always" } },
    ]);
    expect(narration).toContain("taps her tiny tools");
    expect(narration).not.toContain("tail puffs up");
    expect(narration).not.toContain("hums a nervous tune");
  });

  it("shows no tell when none is ambient", async () => {
    const narration = await greet([
      { id: "t1", text: "tail puffs up", trigger: { kind: "clue", clue_ids: ["c1"] } },
    ]);
    expect(narration).toBe("[Mock] Eva is here in Leaf-Lab. she looks neat.");
  });
});

