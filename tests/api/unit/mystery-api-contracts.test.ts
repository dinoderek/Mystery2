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
  ImageLinkRequestSchema,
  ImageLinkResponseSchema,
  MoveResponseSchema,
  SearchResponseSchema,
  SpeakerSchema,
  TalkAskResponseSchema,
} from "../../../packages/shared/src/mystery-api-contracts.ts";
import {
  NARRATOR_SPEAKER,
  characterSpeaker,
  createGameState,
  createSessionSummary,
  createSessionCatalog,
  createBlueprintSummary,
  createMoveResponse,
  createImageLinkResponse,
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

  it("validates image-link request and response schemas", () => {
    expect(
      ImageLinkRequestSchema.parse({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
        image_id: "mock-blueprint.blueprint.png",
      }),
    ).toMatchObject({
      image_id: "mock-blueprint.blueprint.png",
    });

    const imageLink = createImageLinkResponse({
      image_id: "mock-blueprint.blueprint.png",
      signed_url: "https://example.com/signed-image",
    });
    expect(
      ImageLinkResponseSchema.parse(imageLink),
    ).toMatchObject({
      image_id: "mock-blueprint.blueprint.png",
    });
  });
});
