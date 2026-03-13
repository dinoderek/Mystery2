import { describe, expect, it } from "vitest";
import {
  BlueprintSummarySchema,
  GameAccuseRequestSchema,
  GameAskRequestSchema,
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

const narratorSpeaker = {
  kind: "narrator",
  key: "narrator",
  label: "Narrator",
} as const;

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
        narration: "Alice answers.",
        speaker: {
          kind: "character",
          key: "character:alice",
          label: "Alice",
        },
        time_remaining: 8,
        mode: "talk",
        current_talk_character: "Alice",
      }),
    ).toMatchObject({
      mode: "talk",
      current_talk_character: "Alice",
      speaker: {
        kind: "character",
      },
    });

    expect(
      SearchResponseSchema.parse({
        narration: "You inspect the room.",
        speaker: narratorSpeaker,
        time_remaining: 8,
        mode: "explore",
      }),
    ).toMatchObject({
      mode: "explore",
      speaker: narratorSpeaker,
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

  it("accepts game state with narration_speaker and history speakers", () => {
    expect(
      GameStateSchema.parse({
        locations: [{ name: "Kitchen" }],
        characters: [
          { first_name: "Alice", last_name: "Smith", location_name: "Kitchen" },
        ],
        time_remaining: 8,
        location: "Kitchen",
        mode: "explore",
        current_talk_character: null,
        narration: "Case begins.",
        narration_speaker: narratorSpeaker,
        history: [
          {
            sequence: 1,
            event_type: "start",
            narration: "Case begins.",
            speaker: narratorSpeaker,
          },
        ],
      }),
    ).toMatchObject({
      mode: "explore",
      location: "Kitchen",
      narration_speaker: narratorSpeaker,
    });
  });

  it("accepts session summary rows with nullable outcome", () => {
    expect(
      SessionSummarySchema.parse({
        game_id: "123e4567-e89b-12d3-a456-426614174000",
        blueprint_id: "123e4567-e89b-12d3-a456-426614174001",
        mystery_title: "The Missing Honey Cakes",
        mystery_available: true,
        can_open: true,
        mode: "explore",
        time_remaining: 7,
        outcome: null,
        last_played_at: "2026-03-10T12:00:00.000Z",
        created_at: "2026-03-09T12:00:00.000Z",
      }),
    ).toMatchObject({
      mystery_title: "The Missing Honey Cakes",
      can_open: true,
      mode: "explore",
    });
  });

  it("requires grouped catalog arrays and counts", () => {
    expect(
      SessionCatalogResponseSchema.parse({
        in_progress: [],
        completed: [
          {
            game_id: "123e4567-e89b-12d3-a456-426614174010",
            blueprint_id: "123e4567-e89b-12d3-a456-426614174020",
            mystery_title: "Unknown Mystery",
            mystery_available: false,
            can_open: false,
            mode: "ended",
            time_remaining: 0,
            outcome: "lose",
            last_played_at: "2026-03-10T12:00:00.000Z",
            created_at: "2026-03-08T12:00:00.000Z",
          },
        ],
        counts: {
          in_progress: 0,
          completed: 1,
        },
      }),
    ).toMatchObject({
      counts: {
        in_progress: 0,
        completed: 1,
      },
    });
  });

  it("accepts optional image identifiers on player-visible payloads", () => {
    expect(
      BlueprintSummarySchema.parse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        title: "Mock Blueprint",
        one_liner: "A mystery",
        target_age: 8,
        blueprint_image_id: "mock-blueprint-123e4567-e89b-12d3-a456-426614174111",
      }),
    ).toMatchObject({
      blueprint_image_id: "mock-blueprint-123e4567-e89b-12d3-a456-426614174111",
    });

    expect(
      MoveResponseSchema.parse({
        narration: "You arrive.",
        speaker: narratorSpeaker,
        mode: "explore",
        current_location: "Kitchen",
        visible_characters: [],
        time_remaining: 8,
        location_image_id: "mock-location-123e4567-e89b-12d3-a456-426614174222",
      }),
    ).toMatchObject({
      location_image_id: "mock-location-123e4567-e89b-12d3-a456-426614174222",
    });

    expect(
      TalkAskResponseSchema.parse({
        narration: "Alice answers.",
        speaker: {
          kind: "character",
          key: "character:alice",
          label: "Alice",
        },
        time_remaining: 8,
        mode: "talk",
        current_talk_character: "Alice",
        character_portrait_image_id:
          "mock-character-123e4567-e89b-12d3-a456-426614174333",
      }),
    ).toMatchObject({
      character_portrait_image_id:
        "mock-character-123e4567-e89b-12d3-a456-426614174333",
    });
  });

  it("validates image-link request and response schemas", () => {
    expect(
      ImageLinkRequestSchema.parse({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
        image_id: "mock-blueprint-123e4567-e89b-12d3-a456-426614174111",
        purpose: "blueprint_cover",
      }),
    ).toMatchObject({
      purpose: "blueprint_cover",
    });

    expect(
      ImageLinkResponseSchema.parse({
        image_id: "mock-blueprint-123e4567-e89b-12d3-a456-426614174111",
        signed_url: "https://example.com/signed-image",
        expires_at: "2099-01-01T00:00:00.000Z",
      }),
    ).toMatchObject({
      image_id: "mock-blueprint-123e4567-e89b-12d3-a456-426614174111",
    });
  });
});
