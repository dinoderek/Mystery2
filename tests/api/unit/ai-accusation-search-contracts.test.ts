import { describe, expect, it } from "vitest";
import {
  parseAccusationJudgeOutput,
  parseAccusationStartOutput,
  parseSearchOutput,
} from "../../../packages/game-engine/src/ai-contracts.ts";

describe("search and accusation AI output contracts", () => {
  it("accepts valid search output", () => {
    expect(parseSearchOutput({ narration: "You find dusty footprints." })).toEqual(
      {
        narration: "You find dusty footprints.",
        revealed_clue_id: null,
        costs_turn: true,
        input_understood: true,
      },
    );
  });

  it("suppresses clue reveal and turn cost when search input is not understood", () => {
    expect(
      parseSearchOutput({
        narration: "You poke around, unsure what you're looking for.",
        revealed_clue_id: "clue-attic-letter",
        costs_turn: true,
        input_understood: false,
      }),
    ).toEqual({
      narration: "You poke around, unsure what you're looking for.",
      revealed_clue_id: null,
      costs_turn: false,
      input_understood: false,
    });
  });

  it("accepts valid accusation start output", () => {
    expect(
      parseAccusationStartOutput({ narration: "You accuse Alice. Who did it?" }),
    ).toEqual({ narration: "You accuse Alice. Who did it?" });
  });

  it("accepts accusation judge output for every resolution", () => {
    for (const resolution of ["continue", "win", "lose"]) {
      expect(
        parseAccusationJudgeOutput({
          narration: "Case notes.",
          accusation_resolution: resolution,
        }),
      ).toEqual({ narration: "Case notes.", accusation_resolution: resolution });
    }
  });

  it("drops a follow_up_prompt a model still sends", () => {
    expect(
      parseAccusationJudgeOutput({
        narration: "I need more detail.",
        accusation_resolution: "continue",
        follow_up_prompt: "Which clue proves motive?",
      }),
    ).toEqual({ narration: "I need more detail.", accusation_resolution: "continue" });
    expect(
      parseAccusationStartOutput({ narration: "Begin.", follow_up_prompt: "Who?" }),
    ).toEqual({ narration: "Begin." });
  });

  it("rejects invalid accusation outputs", () => {
    expect(() =>
      parseAccusationJudgeOutput({
        narration: "Invalid result",
        accusation_resolution: "maybe",
      }),
    ).toThrow("accusation_resolution");

    expect(() =>
      parseAccusationJudgeOutput({ narration: "", accusation_resolution: "continue" }),
    ).toThrow("narration");
  });
});
