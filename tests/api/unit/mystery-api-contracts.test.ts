import { describe, expect, it } from "vitest";
import {
  BlueprintSummarySchema,
  NarrationEventSchema,
  SessionCatalogResponseSchema,
  SessionSummarySchema,
  GameEnterRequestSchema,
  GameEnterResponseSchema,
  GameGetRequestSchema,
  GameStartRequestSchema,
  NarrationPartSchema,
  GameStateSchema,
  SpeakerSchema,
  AISettingsStateSchema,
  AISettingsUpdateSchema,
  GameTurnRequestSchema,
  GameTurnResponseSchema,
} from "../../../packages/shared/src/mystery-api-contracts.ts";
import {
  NARRATOR_SPEAKER,
  characterSpeaker,
  createGameState,
  createSessionSummary,
  createSessionCatalog,
  createBlueprintSummary,
  createGameEnterResponse,
  createNarrationEvent,
  createNotebookLead,
  createRevealedClue,
  createTurnPlayedResponse,
  createTurnRefusedResponse,
  createTurnViewResponse,
} from "../../testkit/src/fixtures.ts";

describe("the game-turn contract", () => {
  const gameId = "123e4567-e89b-12d3-a456-426614174000";

  it("takes the game and the line as typed, an empty line included", () => {
    expect(GameTurnRequestSchema.parse({ game_id: gameId, input: "go to the kitchen" })).toEqual({
      game_id: gameId,
      input: "go to the kitchen",
    });
    expect(GameTurnRequestSchema.safeParse({ game_id: gameId, input: "" }).success).toBe(true);
    expect(GameTurnRequestSchema.safeParse({ game_id: gameId }).success).toBe(false);
    expect(GameTurnRequestSchema.safeParse({ game_id: "kitchen", input: "search" }).success).toBe(false);
  });

  it("answers with one of four kinds", () => {
    for (const answer of [
      createTurnPlayedResponse(),
      createTurnRefusedResponse(),
      createTurnViewResponse({ view: "locations", section: "places" }),
      { kind: "quit" },
    ]) {
      expect(GameTurnResponseSchema.parse(answer)).toEqual(answer);
    }
    expect(GameTurnResponseSchema.safeParse({ kind: "dance" }).success).toBe(false);
  });

  it("keeps where a clue came from, for the notebook", () => {
    const clue = {
      id: "clue-1",
      text: "A crumb.",
      source: "talk",
      origin: { kind: "character", character_id: "char-alice", character_name: "Alice Smith" },
      discovered_at: "2026-11-14T10:00:00.000Z",
      off_script: true,
    };
    const answer = createTurnPlayedResponse({ revealed_clues: [clue as never] });

    expect(GameTurnResponseSchema.parse(answer)).toMatchObject({ revealed_clues: [clue] });
  });

  it("refuses a played turn with no events", () => {
    expect(GameTurnResponseSchema.safeParse({ ...createTurnPlayedResponse(), events: [] }).success).toBe(false);
  });
});

describe("the notebook", () => {
  it("carries leads with a new mark, taken-back clues and clue kinds, and no truth, rule or gate field", () => {
    const answer = GameTurnResponseSchema.parse({
      ...createTurnPlayedResponse(),
      revealed_clues: [{ ...createRevealedClue({ kind: "statement", taken_back: false }), truth: false, rule: "any", gate: { line: "ask" } }],
      leads: [{ ...createNotebookLead({ new: true }), truth: true, rule: "all", gate: "x" }],
      taken_back: ["thorne_never_set_foot"],
      conclusions: ["toby_cleared"],
    });
    if (answer.kind !== "turn") throw new Error("Expected a turn");
    expect(answer.leads).toEqual([{ key: "talk:thorne", text: "Mr. Thorne may know more.", new: true }]);
    expect(answer.taken_back).toEqual(["thorne_never_set_foot"]);
    expect(answer.revealed_clues[0]).toMatchObject({ kind: "statement", taken_back: false });
    expect(JSON.stringify(answer)).not.toMatch(/truth|rule|gate|conclusions/);
  });

  it("carries leads on the game state", () => {
    expect(GameStateSchema.parse(createGameState({ leads: [createNotebookLead()] })).leads).toHaveLength(1);
  });

  it("refuses a game state without leads, and a played turn without leads or taken_back", () => {
    const without = (value: object, key: string) => Object.fromEntries(Object.entries(value).filter(([field]) => field !== key));
    expect(GameStateSchema.safeParse(without(createGameState(), "leads")).success).toBe(false);
    expect(GameTurnResponseSchema.safeParse(without(createTurnPlayedResponse(), "leads")).success).toBe(false);
    expect(GameTurnResponseSchema.safeParse(without(createTurnPlayedResponse(), "taken_back")).success).toBe(false);
  });

  it("accepts an arrival where someone has one name, as a clue-graph case writes them", () => {
    const entered = createGameEnterResponse({
      visible_characters: [{ first_name: "Mr. Thorne", last_name: "", sex: "male" }],
    });
    expect(GameEnterResponseSchema.parse(entered).visible_characters).toEqual([
      { first_name: "Mr. Thorne", last_name: "", sex: "male" },
    ]);
  });

  it("refuses an unknown clue kind and a lead with no new mark", () => {
    expect(() => createRevealedClue({ kind: "conclusion" as never })).toThrow();
    expect(() => createNotebookLead({ new: undefined as never })).toThrow();
  });
});

describe("shared mystery API contracts", () => {
  it("accepts game-start requests with optional ai_profile", () => {
    expect(
      GameStartRequestSchema.parse({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    ).toEqual({
      blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(
      GameStartRequestSchema.parse({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
        ai_profile: "free",
      }),
    ).toEqual({
      blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      ai_profile: "free",
    });
  });

  it("trims ai_profile and refuses one that is empty once trimmed", () => {
    const blueprint_id = "123e4567-e89b-12d3-a456-426614174000";
    expect(GameStartRequestSchema.parse({ blueprint_id, ai_profile: " free " })).toEqual({
      blueprint_id,
      ai_profile: "free",
    });
    expect(GameStartRequestSchema.safeParse({ blueprint_id, ai_profile: "   " }).success).toBe(false);
    expect(GameStartRequestSchema.safeParse({ blueprint_id: "not-a-uuid" }).success).toBe(false);
  });

  it("requires a game id on game-enter and game-get requests", () => {
    const game_id = "123e4567-e89b-12d3-a456-426614174000";
    for (const schema of [GameEnterRequestSchema, GameGetRequestSchema]) {
      expect(schema.parse({ game_id })).toEqual({ game_id });
      expect(schema.safeParse({}).success).toBe(false);
      expect(schema.safeParse({ game_id: "nope" }).success).toBe(false);
    }
  });

  it("requires speaker metadata on narration", () => {
    expect(
      NarrationPartSchema.parse({ text: "Alice answers.", speaker: characterSpeaker("Alice") }),
    ).toMatchObject({ speaker: { kind: "character" } });
    expect(NarrationPartSchema.safeParse({ text: "Alice answers." }).success).toBe(false);
  });

  it("validates speaker schema", () => {
    expect(() =>
      SpeakerSchema.parse({
        kind: "character",
        key: "",
        label: "Alice",
      })
    ).toThrow();

    expect(
      SpeakerSchema.parse({
        kind: "system",
        key: "system",
        label: "System",
      }),
    ).toMatchObject({
      kind: "system",
    });
  });

  it("accepts game state plus persisted narration events", () => {
    const gameState = createGameState({ time_remaining: 8 });
    expect(
      GameStateSchema.parse(gameState),
    ).toMatchObject({
      mode: "explore",
      location: "Kitchen",
    });

    const event = createNarrationEvent();
    expect(
      NarrationEventSchema.parse(event),
    ).toMatchObject({
      narration_parts: event.narration_parts,
    });
  });

  it("accepts session summary rows with nullable outcome", () => {
    const summary = createSessionSummary({
      mystery_title: "The Missing Honey Cakes",
      time_remaining: 7,
    });
    expect(
      SessionSummarySchema.parse(summary),
    ).toMatchObject({
      mystery_title: "The Missing Honey Cakes",
      mode: "explore",
    });
  });

  it("requires grouped catalog arrays and counts", () => {
    const catalog = createSessionCatalog({
      completed: [
        createSessionSummary({
          game_id: "123e4567-e89b-12d3-a456-426614174010",
          blueprint_id: "123e4567-e89b-12d3-a456-426614174020",
          mystery_title: "Unknown Mystery",
          mystery_available: false,
          mode: "ended",
          time_remaining: 0,
          outcome: "lose",
        }),
      ],
      counts: { in_progress: 0, completed: 1 },
    });
    expect(
      SessionCatalogResponseSchema.parse(catalog),
    ).toMatchObject({
      counts: {
        in_progress: 0,
        completed: 1,
      },
    });
  });

  it("accepts optional image identifiers on player-visible payloads", () => {
    const blueprint = createBlueprintSummary({
      title: "Mock Blueprint",
      one_liner: "A mystery",
      target_age: 8,
      blueprint_image_id: "mock-blueprint.blueprint.png",
    });
    expect(
      BlueprintSummarySchema.parse(blueprint),
    ).toMatchObject({
      blueprint_image_id: "mock-blueprint.blueprint.png",
    });

    const entered = createGameEnterResponse({
      narration_parts: [{
        text: "You arrive.",
        speaker: NARRATOR_SPEAKER,
        image_id: "mock-blueprint.location-loc-kitchen.png",
      }],
      current_location: "Kitchen",
      visible_characters: [
        { first_name: "Alice", last_name: "Smith", sex: "female" },
      ],
      time_remaining: 8,
    });
    expect(
      GameEnterResponseSchema.parse(entered),
    ).toMatchObject({
      narration_parts: [
        { image_id: "mock-blueprint.location-loc-kitchen.png" },
      ],
      visible_characters: [
        { sex: "female" },
      ],
    });

    expect(
      NarrationPartSchema.parse({
        text: "Alice answers.",
        speaker: characterSpeaker("Alice"),
        image_id: "mock-blueprint.character-char-alice.png",
      }),
    ).toMatchObject({ image_id: "mock-blueprint.character-char-alice.png" });
  });

});

describe("AI settings", () => {
  const state = {
    ais: [
      { name: "mock", backend: "mock", model: "mock/runtime-default", problem: null },
      { name: "luna6", backend: "openrouter", model: "openai/gpt-6-luna", problem: null },
      { name: "claude", backend: "claude-cli", model: "sonnet", problem: null },
    ],
    chosen: "luna6",
    configured_default: null,
    override: null,
    narrator: { name: "luna6", backend: "openrouter", model: "openai/gpt-6-luna" },
    narrator_error: null,
  };

  it("accepts a full settings state", () => {
    expect(AISettingsStateSchema.parse(state)).toEqual(state);
  });

  it("carries no field that could hold a key", () => {
    // An AI is named by its name, backend and model. A `key` field appearing
    // here would be the first sign something started copying one out.
    const shape = AISettingsStateSchema.parse({ ...state, ais: [{ ...state.ais[1], key: "sk-or-secret" }] });

    expect(Object.keys(shape.ais[0])).toEqual(["name", "backend", "model", "problem"]);
    expect(JSON.stringify(shape)).not.toContain("sk-or-secret");
  });

  it("accepts an override and a missing narrator with its reason", () => {
    const parsed = AISettingsStateSchema.parse({
      ...state,
      chosen: "gone",
      override: { name: "claude", backend: "claude-cli", model: "sonnet" },
      narrator: null,
      narrator_error: 'The AI chosen on the settings page, "gone", is not in ai.json.',
    });
    expect(parsed.override?.backend).toBe("claude-cli");
    expect(parsed.narrator_error).toMatch(/"gone"/);
  });

  it("accepts the AI ai.json names as its default", () => {
    expect(AISettingsStateSchema.parse({ ...state, chosen: null, configured_default: "luna6" }).configured_default).toBe("luna6");
  });

  it("accepts nothing chosen, and an AI that lacks what it needs", () => {
    const parsed = AISettingsStateSchema.parse({
      ...state,
      chosen: null,
      ais: [{ name: "free", backend: "openrouter", model: "vendor/free", problem: 'AI "free" has no key' }],
    });
    expect(parsed.chosen).toBeNull();
    expect(parsed.ais[0].problem).toMatch(/no key/);
  });

  it("rejects a backend it does not know", () => {
    expect(() =>
      AISettingsStateSchema.parse({ ...state, ais: [{ ...state.ais[0], backend: "anthropic" }] }),
    ).toThrow();
  });

  it("takes one name as an update, and refuses an empty one", () => {
    expect(AISettingsUpdateSchema.parse({ name: " luna6 " })).toEqual({ name: "luna6" });
    expect(() => AISettingsUpdateSchema.parse({ name: " " })).toThrow();
    expect(() => AISettingsUpdateSchema.parse({})).toThrow();
  });
});
