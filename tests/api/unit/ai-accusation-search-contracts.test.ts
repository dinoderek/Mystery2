import { describe, expect, it } from "vitest";
import {
  parseAccusationStartOutput,
  parseGraphAccusationOutput,
  parseGraphSearchOutput,
} from "../../../packages/game-engine/src/ai-contracts.ts";

describe("search and accusation AI output contracts", () => {
  it("accepts valid search output", () => {
    expect(parseGraphSearchOutput({ narration: "You find dusty footprints." })).toEqual({
      narration: "You find dusty footprints.",
      revealed_clue_id: null,
      costs_turn: true,
      input_understood: true,
      notebook: [],
    });
  });

  it("suppresses clue reveal, notebook lines and turn cost when search input is not understood", () => {
    expect(
      parseGraphSearchOutput({
        narration: "You poke around, unsure what you're looking for.",
        revealed_clue_id: "clue-attic-letter",
        costs_turn: true,
        input_understood: false,
        notebook: [{ id: "clue-attic-letter", line: "A letter." }],
      }),
    ).toEqual({
      narration: "You poke around, unsure what you're looking for.",
      revealed_clue_id: null,
      costs_turn: false,
      input_understood: false,
      notebook: [],
    });
  });

  it("accepts valid accusation start output", () => {
    expect(
      parseAccusationStartOutput({ narration: "You accuse Alice. Who did it?" }),
    ).toEqual({ narration: "You accuse Alice. Who did it?" });
  });

  it("drops a follow_up_prompt a model still sends", () => {
    expect(
      parseAccusationStartOutput({ narration: "Begin.", follow_up_prompt: "Who?" }),
    ).toEqual({ narration: "Begin." });
  });

  it("reads who an accusation named and the clues it cited, once each", () => {
    expect(parseGraphAccusationOutput({ accused_character_id: "alice", cited_clue_ids: ["a", "a", "", "b"] })).toEqual({
      accused_character_id: "alice",
      cited_clue_ids: ["a", "b"],
    });
    expect(parseGraphAccusationOutput({ accused_character_id: null })).toEqual({ accused_character_id: null, cited_clue_ids: [] });
  });

  it("rejects invalid accusation outputs", () => {
    expect(() => parseAccusationStartOutput({ narration: "" })).toThrow("narration");
    expect(() => parseGraphAccusationOutput({ accused_character_id: 3 })).toThrow("accused_character_id");
  });
});
