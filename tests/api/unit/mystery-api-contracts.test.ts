import { describe, expect, it } from "vitest";
import {
  GameAskRequestSchema,
  GameStateSchema,
  SearchResponseSchema,
  TalkAskResponseSchema,
} from "../../../packages/shared/src/mystery-api-contracts.ts";

describe("shared mystery API contracts", () => {
  it("requires player_input for game-ask requests", () => {
    expect(() =>
      GameAskRequestSchema.parse({
        game_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
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

  it("accepts talk/search responses without clue fields", () => {
    expect(
      TalkAskResponseSchema.parse({
        narration: "Alice answers.",
        time_remaining: 8,
        mode: "talk",
        current_talk_character: "Alice",
      }),
    ).toMatchObject({
      mode: "talk",
      current_talk_character: "Alice",
    });

    expect(
      SearchResponseSchema.parse({
        narration: "You inspect the room.",
        time_remaining: 8,
        mode: "explore",
      }),
    ).toMatchObject({
      mode: "explore",
    });
  });

  it("accepts game state without clues", () => {
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
        history: [
          {
            sequence: 1,
            event_type: "start",
            actor: "system",
            narration: "Case begins.",
          },
        ],
      }),
    ).toMatchObject({
      mode: "explore",
      location: "Kitchen",
    });
  });
});
