import { describe, expect, it } from "vitest";
import {
  BlueprintSummarySchema,
  GameAccuseRequestSchema,
  GameAskRequestSchema,
  GameMoveRequestSchema,
  GameSearchRequestSchema,
  GameTalkRequestSchema,
  NarrationEventSchema,
  SessionCatalogResponseSchema,
  SessionSummarySchema,
  GameStartRequestSchema,
  GameStateSchema,
  MoveResponseSchema,
  SearchResponseSchema,
  SpeakerSchema,
  TalkAskResponseSchema,
  AIKeyUpsertSchema,
  AIModelUpsertSchema,
  AISettingsStateSchema,
  AISettingsUpdateSchema,
} from "../../../packages/shared/src/mystery-api-contracts.ts";
import {
  NARRATOR_SPEAKER,
  characterSpeaker,
  createGameState,
  createSessionSummary,
  createSessionCatalog,
  createBlueprintSummary,
  createMoveResponse,
  createNarrationEvent,
} from "../../testkit/src/fixtures.ts";

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

  it("requires player_input for game-ask requests", () => {
    expect(() =>
      GameAskRequestSchema.parse({
        game_id: "123e4567-e89b-12d3-a456-426614174000",
      })
    ).toThrow();

    expect(
      GameAskRequestSchema.parse({
        game_id: "123e4567-e89b-12d3-a456-426614174000",
        player_input: "Where were you?",
      }),
    ).toEqual({
      game_id: "123e4567-e89b-12d3-a456-426614174000",
      player_input: "Where were you?",
    });
  });

  it("requires destination for game-move requests", () => {
    expect(() =>
      GameMoveRequestSchema.parse({
        game_id: "123e4567-e89b-12d3-a456-426614174000",
      })
    ).toThrow();

    expect(
      GameMoveRequestSchema.parse({
        game_id: "123e4567-e89b-12d3-a456-426614174000",
        destination: "loc-kitchen",
      }),
    ).toEqual({
      game_id: "123e4567-e89b-12d3-a456-426614174000",
      destination: "loc-kitchen",
    });
  });

  it("accepts game-search requests with only game_id", () => {
    expect(
      GameSearchRequestSchema.parse({
        game_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    ).toEqual({
      game_id: "123e4567-e89b-12d3-a456-426614174000",
    });
  });

  it("requires character_id (not character_name) for game-talk requests", () => {
    expect(() =>
      GameTalkRequestSchema.parse({
        game_id: "123e4567-e89b-12d3-a456-426614174000",
      })
    ).toThrow();

    expect(
      GameTalkRequestSchema.parse({
        game_id: "123e4567-e89b-12d3-a456-426614174000",
        character_id: "char-alice",
      }),
    ).toEqual({
      game_id: "123e4567-e89b-12d3-a456-426614174000",
      character_id: "char-alice",
    });

    // Verify character_name alone does NOT satisfy the schema
    expect(() =>
      GameTalkRequestSchema.parse({
        game_id: "123e4567-e89b-12d3-a456-426614174000",
        character_name: "Alice",
      })
    ).toThrow();
  });

  it("accepts reasoning-first game-accuse requests", () => {
    expect(
      GameAccuseRequestSchema.parse({
        game_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    ).toEqual({
      game_id: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(
      GameAccuseRequestSchema.parse({
        game_id: "123e4567-e89b-12d3-a456-426614174000",
        player_reasoning: "I accuse Alice because of the timeline.",
      }),
    ).toEqual({
      game_id: "123e4567-e89b-12d3-a456-426614174000",
      player_reasoning: "I accuse Alice because of the timeline.",
    });
  });

  it("requires speaker metadata on narration responses", () => {
    expect(
      TalkAskResponseSchema.parse({
        narration_parts: [{
          text: "Alice answers.",
          speaker: characterSpeaker("Alice"),
        }],
        time_remaining: 8,
        mode: "talk",
        current_talk_character: "Alice",
      }),
    ).toMatchObject({
      mode: "talk",
      current_talk_character: "Alice",
      narration_parts: [{ speaker: { kind: "character" } }],
    });

    expect(
      SearchResponseSchema.parse({
        narration_parts: [{
          text: "You inspect the room.",
          speaker: NARRATOR_SPEAKER,
        }],
        time_remaining: 8,
        mode: "explore",
      }),
    ).toMatchObject({
      mode: "explore",
      narration_parts: [{ speaker: NARRATOR_SPEAKER }],
    });
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

    const moveResponse = createMoveResponse({
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
      MoveResponseSchema.parse(moveResponse),
    ).toMatchObject({
      narration_parts: [
        { image_id: "mock-blueprint.location-loc-kitchen.png" },
      ],
      visible_characters: [
        { sex: "female" },
      ],
    });

    expect(
      TalkAskResponseSchema.parse({
        narration_parts: [{
          text: "Alice answers.",
          speaker: characterSpeaker("Alice"),
          image_id: "mock-blueprint.character-char-alice.png",
        }],
        time_remaining: 8,
        mode: "talk",
        current_talk_character: "Alice",
      }),
    ).toMatchObject({
      narration_parts: [
        { image_id: "mock-blueprint.character-char-alice.png" },
      ],
    });
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
