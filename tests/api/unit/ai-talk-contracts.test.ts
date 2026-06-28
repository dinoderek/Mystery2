import { describe, expect, it } from "vitest";
import {
  parseTalkConversationOutput,
  parseTalkEndOutput,
  parseTalkStartOutput,
} from "../../../supabase/functions/_shared/ai-contracts.ts";

describe("talk AI output contracts", () => {
  it("accepts valid talk-start output", () => {
    expect(
      parseTalkStartOutput({
        narration: "Hello investigator.",
      }),
    ).toEqual({ narration: "Hello investigator." });
  });

  it("accepts valid talk-conversation output without revealed_clue_ids", () => {
    expect(
      parseTalkConversationOutput({
        narration: "I was in the kitchen when the cookie jar opened.",
      }),
    ).toEqual({
      narration: "I was in the kitchen when the cookie jar opened.",
      revealed_clue_ids: [],
      revealed_off_script: [],
      input_understood: true,
    });
  });

  it("accepts valid talk-conversation output with revealed_clue_ids", () => {
    expect(
      parseTalkConversationOutput({
        narration: "Fine, I saw her leave at nine.",
        revealed_clue_ids: ["clue-alibi-witness"],
      }),
    ).toEqual({
      narration: "Fine, I saw her leave at nine.",
      revealed_clue_ids: ["clue-alibi-witness"],
      revealed_off_script: [],
      input_understood: true,
    });
  });

  it("keeps off-script ids that are a subset of revealed, drops the rest", () => {
    const result = parseTalkConversationOutput({
      narration: "Alright, you got me — she left at nine.",
      revealed_clue_ids: ["clue-alibi-witness"],
      revealed_off_script: ["clue-alibi-witness", "not-revealed"],
    });
    expect(result.revealed_off_script).toEqual(["clue-alibi-witness"]);
  });

  it("filters invalid revealed_clue_ids entries", () => {
    const result = parseTalkConversationOutput({
      narration: "Some narration.",
      revealed_clue_ids: ["valid-id", "", 42, null, "another-valid"],
    });
    expect(result.revealed_clue_ids).toEqual(["valid-id", "another-valid"]);
  });

  it("suppresses revealed clues when input is not understood", () => {
    const result = parseTalkConversationOutput({
      narration: "Sorry — what?",
      revealed_clue_ids: ["clue-alibi-witness"],
      input_understood: false,
    });
    expect(result).toEqual({
      narration: "Sorry — what?",
      revealed_clue_ids: [],
      revealed_off_script: [],
      input_understood: false,
    });
  });

  it("accepts valid talk-end output", () => {
    expect(
      parseTalkEndOutput({
        narration: "You conclude the chat and return to exploring.",
      }),
    ).toEqual({
      narration: "You conclude the chat and return to exploring.",
    });
  });

  it("rejects missing narration", () => {
    expect(() => parseTalkStartOutput({})).toThrow("narration");
    expect(() => parseTalkConversationOutput({ narration: "" })).toThrow(
      "narration",
    );
    expect(() => parseTalkEndOutput({ narration: null })).toThrow("narration");
  });
});
