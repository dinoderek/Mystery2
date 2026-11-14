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
  AIKeyUpsertSchema,
  AIModelUpsertSchema,
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
      can_open: true,
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
          can_open: false,
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
    effective_mode: "openrouter",
    stored_mode: "openrouter",
    selected_key_label: "work",
    selected_model_label: "sonnet",
    missing_key_label: null,
    missing_model_label: null,
    keys: [{ label: "work", source: "user", masked: "...1234" }],
    models: [{ label: "sonnet", model_id: "vendor/model", source: "env" }],
    override: null,
  };

  it("accepts a full settings state", () => {
    expect(AISettingsStateSchema.parse(state)).toMatchObject({
      effective_mode: "openrouter",
    });
  });

  it("carries no field that could hold a stored key", () => {
    // The one rule this whole surface exists to keep. A key leaves the server
    // as `masked` and nothing else, so an added `api_key` here would be the
    // first sign that something started serialising the real value.
    const shape = AISettingsStateSchema.parse(state);
    const keyFields = Object.keys(shape.keys[0]);

    expect(keyFields).toEqual(["label", "source", "masked"]);
    expect(JSON.stringify(shape)).not.toContain("api_key");
  });

  it("accepts an override naming only the provider and model", () => {
    expect(
      AISettingsStateSchema.parse({
        ...state,
        override: { provider: "openrouter", model: "vendor/model", source: "AI_PROVIDER / AI_MODEL" },
      }).override,
    ).toEqual({
      provider: "openrouter",
      model: "vendor/model",
      source: "AI_PROVIDER / AI_MODEL",
    });
  });

  it("lets the override and the effective mode name the claude CLI, but not the stored mode", () => {
    const withCli = AISettingsStateSchema.parse({
      ...state,
      effective_mode: "claude-cli",
      override: { provider: "claude-cli", model: "sonnet", source: "AI_PROVIDER / AI_MODEL" },
    });
    expect(withCli.effective_mode).toBe("claude-cli");
    expect(withCli.override?.provider).toBe("claude-cli");

    // The settings page chooses between mock and OpenRouter only.
    expect(() => AISettingsStateSchema.parse({ ...state, stored_mode: "claude-cli" })).toThrow();
  });

  it("reports a dangling selection rather than hiding it", () => {
    expect(
      AISettingsStateSchema.parse({
        ...state,
        effective_mode: "mock",
        missing_key_label: "work",
        keys: [],
      }),
    ).toMatchObject({ effective_mode: "mock", missing_key_label: "work" });
  });

  it("rejects an unknown mode", () => {
    expect(() => AISettingsStateSchema.parse({ ...state, stored_mode: "anthropic" })).toThrow();
  });

  it("treats null as a meaningful update, and an empty one as a mistake", () => {
    // Clearing a selection is `null`; sending nothing at all is a caller bug.
    expect(AISettingsUpdateSchema.parse({ key_label: null })).toEqual({ key_label: null });
    expect(() => AISettingsUpdateSchema.parse({})).toThrow();
  });

  it("requires a label and a value on both upserts", () => {
    expect(AISettingsUpdateSchema.parse({ mode: "mock" })).toEqual({ mode: "mock" });
    expect(() => AIKeyUpsertSchema.parse({ label: "", api_key: "sk" })).toThrow();
    expect(() => AIKeyUpsertSchema.parse({ label: "work" })).toThrow();
    expect(() => AIModelUpsertSchema.parse({ label: "sonnet", model_id: "" })).toThrow();
  });
});
