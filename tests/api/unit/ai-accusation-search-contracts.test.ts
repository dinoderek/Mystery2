import { describe, expect, it } from "vitest";
import {
  parseAccusationJudgeOutput,
  parseAccusationStartOutput,
  parseSearchOutput,
} from "../../../supabase/functions/_shared/ai-contracts.ts";

describe("search and accusation AI output contracts", () => {
  it("accepts valid search output", () => {
    expect(parseSearchOutput({ narration: "You find dusty footprints." })).toEqual(
      { narration: "You find dusty footprints." },
    );
  });

  it("accepts valid accusation start output", () => {
    expect(
      parseAccusationStartOutput({
        narration: "You accuse Alice.",
        follow_up_prompt: "Explain your theory.",
      }),
    ).toEqual({
      narration: "You accuse Alice.",
      follow_up_prompt: "Explain your theory.",
    });
  });

  it("accepts accusation judge continue output with follow-up", () => {
    expect(
      parseAccusationJudgeOutput({
        narration: "I need more detail.",
        accusation_resolution: "continue",
        follow_up_prompt: "Which clue proves motive?",
        inferred_accused_character: null,
      }),
    ).toEqual({
      narration: "I need more detail.",
      accusation_resolution: "continue",
      follow_up_prompt: "Which clue proves motive?",
      inferred_accused_character: null,
    });
  });

  it("accepts accusation judge terminal output with null follow-up", () => {
    expect(
      parseAccusationJudgeOutput({
        narration: "Case closed.",
        accusation_resolution: "win",
        follow_up_prompt: null,
        inferred_accused_character: "Alice",
      }),
    ).toEqual({
      narration: "Case closed.",
      accusation_resolution: "win",
      follow_up_prompt: null,
      inferred_accused_character: "Alice",
    });
  });

  it("rejects invalid accusation outputs", () => {
    expect(() =>
      parseAccusationJudgeOutput({
        narration: "Invalid result",
        accusation_resolution: "maybe",
      }),
    ).toThrow("accusation_resolution");

    expect(() =>
      parseAccusationJudgeOutput({
        narration: "Need more detail",
        accusation_resolution: "continue",
        follow_up_prompt: null,
      }),
    ).toThrow("follow_up_prompt");

    expect(() =>
      parseAccusationJudgeOutput({
        narration: "Resolved but unclear suspect",
        accusation_resolution: "lose",
        follow_up_prompt: null,
        inferred_accused_character: null,
      }),
    ).toThrow("inferred_accused_character");
  });
});
