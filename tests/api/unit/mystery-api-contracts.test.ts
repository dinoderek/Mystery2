import { describe, expect, it } from "vitest";
import {
  GameAskRequestSchema,
  GameStateSchema,
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
});
