import { describe, expect, it } from "vitest";
import {
  parseAccusationJudgeOutput,
  parseGraphTalkOutput,
  parseSearchOutput,
  parseTalkConversationOutput,
  parseTalkEndOutput,
  parseTalkStartOutput,
} from "../../../packages/game-engine/src/ai-contracts.ts";

describe("talk AI output contracts", () => {
  it("shows the player quotes a model escaped twice as plain quotes, in every role", () => {
    const twice = 'Mr. Pike tips his cap. \\"Well spotted,\\" he says.';
    const plain = 'Mr. Pike tips his cap. "Well spotted," he says.';
    expect(parseTalkStartOutput({ narration: twice }).narration).toBe(plain);
    expect(parseGraphTalkOutput({ narration: twice }).narration).toBe(plain);
    expect(parseSearchOutput({ narration: twice }).narration).toBe(plain);
    expect(parseAccusationJudgeOutput({ narration: twice, accusation_resolution: "win" }).narration).toBe(plain);
    expect(parseTalkStartOutput({ narration: plain }).narration).toBe(plain);
  });

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
      used_clue_ids: [],
      used_quote: null,
      new_commitments: [],
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
      used_clue_ids: [],
      used_quote: null,
      new_commitments: [],
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

  it("suppresses reveals, uses and commitments when input is not understood", () => {
    const result = parseTalkConversationOutput({
      narration: "Sorry — what?",
      revealed_clue_ids: ["clue-alibi-witness"],
      input_understood: false,
      used_clue_ids: ["clue-prints"],
      used_quote: "prints",
      new_commitments: ["never there"],
    });
    expect(result).toEqual({
      narration: "Sorry — what?",
      revealed_clue_ids: [],
      revealed_off_script: [],
      input_understood: false,
      used_clue_ids: [],
      used_quote: null,
      new_commitments: [],
    });
  });

  it("accepts the used clues, their quote and new commitments", () => {
    const result = parseTalkConversationOutput({
      narration: "Snowshoes? I never owned any.",
      used_clue_ids: ["clue-prints", "clue-prints", "", 7],
      used_quote: "the prints are snowshoes, not paws",
      new_commitments: [" never owned snowshoes ", "", null],
    });
    expect(result).toMatchObject({
      used_clue_ids: ["clue-prints"],
      used_quote: "the prints are snowshoes, not paws",
      new_commitments: ["never owned snowshoes"],
    });
  });

  it("drops a quote when no clue was used, and treats a blank quote as none", () => {
    expect(parseTalkConversationOutput({ narration: "Hm.", used_quote: "hello" }).used_quote).toBeNull();
    expect(
      parseTalkConversationOutput({ narration: "Hm.", used_clue_ids: ["clue-prints"], used_quote: "  " }).used_quote,
    ).toBeNull();
  });

  it("rejects new fields of the wrong shape", () => {
    expect(() => parseTalkConversationOutput({ narration: "Hm.", used_clue_ids: "clue-prints" })).toThrow(
      '"used_clue_ids" must be a list of strings',
    );
    expect(() => parseTalkConversationOutput({ narration: "Hm.", used_quote: 3 })).toThrow(
      '"used_quote" must be a non-empty string or null',
    );
    expect(() => parseTalkConversationOutput({ narration: "Hm.", new_commitments: { a: 1 } })).toThrow(
      '"new_commitments" must be a list of strings',
    );
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
