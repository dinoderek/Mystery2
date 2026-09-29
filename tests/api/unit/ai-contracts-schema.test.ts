import { describe, expect, it } from "vitest";
import {
  type AIRoleName,
  parseAccusationJudgeOutput,
  parseAccusationStartOutput,
  parseSearchOutput,
  parseTalkConversationOutput,
  parseTalkEndOutput,
  parseTalkStartOutput,
  roleOutputJsonSchema,
} from "../../../packages/game-engine/src/ai-contracts.ts";

// The smallest output that satisfies each role's JSON Schema. If the schema and
// the parser drifted apart, one of these would be asked for and then refused.
const MINIMAL_OUTPUTS: Record<
  AIRoleName,
  { fields: string[]; sample: Record<string, unknown>; parse: (value: unknown) => unknown }
> = {
  talk_start: {
    fields: ["narration"],
    sample: { narration: "Hi." },
    parse: parseTalkStartOutput,
  },
  talk_conversation: {
    fields: ["narration", "revealed_clue_ids", "revealed_off_script", "input_understood"],
    sample: {
      narration: "Hi.",
      revealed_clue_ids: [],
      revealed_off_script: [],
      input_understood: true,
    },
    parse: parseTalkConversationOutput,
  },
  talk_end: {
    fields: ["narration"],
    sample: { narration: "Bye." },
    parse: parseTalkEndOutput,
  },
  search: {
    fields: ["narration", "revealed_clue_id", "costs_turn", "input_understood"],
    sample: {
      narration: "Dust.",
      revealed_clue_id: null,
      costs_turn: true,
      input_understood: true,
    },
    parse: parseSearchOutput,
  },
  accusation_start: {
    fields: ["narration", "follow_up_prompt"],
    sample: { narration: "Really?", follow_up_prompt: "Why?" },
    parse: parseAccusationStartOutput,
  },
  accusation_judge: {
    fields: ["narration", "accusation_resolution", "follow_up_prompt"],
    sample: { narration: "Yes.", accusation_resolution: "win", follow_up_prompt: null },
    parse: parseAccusationJudgeOutput,
  },
};

describe("role output JSON Schemas", () => {
  for (const [role, { fields, sample, parse }] of Object.entries(MINIMAL_OUTPUTS)) {
    it(`asks for every ${role} field and nothing else`, () => {
      const schema = roleOutputJsonSchema(role as AIRoleName);

      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);
      expect(Object.keys(schema.properties as object)).toEqual(fields);
      expect(schema.required).toEqual(fields);
    });

    it(`parses the minimal ${role} output the schema asks for`, () => {
      expect(() => parse(sample)).not.toThrow();
    });
  }

  it("describes the shapes the parsers enforce", () => {
    const search = roleOutputJsonSchema("search").properties as Record<string, unknown>;
    expect(search.revealed_clue_id).toEqual({
      anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
    });

    const judge = roleOutputJsonSchema("accusation_judge").properties as Record<
      string,
      unknown
    >;
    expect(judge.accusation_resolution).toEqual({
      type: "string",
      enum: ["win", "lose", "continue"],
    });
  });
});

describe("role output parsing tolerance", () => {
  it("rejects anything but an object", () => {
    expect(() => parseTalkStartOutput(null)).toThrow(
      "Invalid AI talk_start output: expected object",
    );
    expect(() => parseTalkStartOutput(["narration"])).toThrow("expected object");
  });

  it("names the role and field in errors", () => {
    expect(() => parseAccusationStartOutput({ narration: "Hm." })).toThrow(
      'Invalid AI accusation_start output: "follow_up_prompt" must be a non-empty string',
    );
    expect(() => parseSearchOutput({ narration: "Hm.", revealed_clue_id: 42 })).toThrow(
      '"revealed_clue_id" must be a non-empty string or null',
    );
  });

  it("trims narration and rejects whitespace-only narration", () => {
    expect(parseTalkEndOutput({ narration: "  Bye.  " })).toEqual({ narration: "Bye." });
    expect(() => parseTalkEndOutput({ narration: "   " })).toThrow("narration");
  });

  it("falls back to the default when a flag is not a boolean", () => {
    expect(
      parseSearchOutput({ narration: "Dust.", costs_turn: "no", input_understood: "yes" }),
    ).toEqual({
      narration: "Dust.",
      revealed_clue_id: null,
      costs_turn: true,
      input_understood: true,
    });
  });

  it("ignores an invalid clue id on a search it did not understand", () => {
    expect(
      parseSearchOutput({ narration: "What?", revealed_clue_id: 42, input_understood: false }),
    ).toEqual({
      narration: "What?",
      revealed_clue_id: null,
      costs_turn: false,
      input_understood: false,
    });
  });

  it("drops off-script ids when the input was not understood", () => {
    expect(
      parseTalkConversationOutput({
        narration: "What?",
        revealed_clue_ids: ["clue-a"],
        revealed_off_script: ["clue-a"],
        input_understood: false,
      }),
    ).toEqual({
      narration: "What?",
      revealed_clue_ids: [],
      revealed_off_script: [],
      input_understood: false,
    });
  });

  it("trims the accusation resolution before checking it", () => {
    expect(
      parseAccusationJudgeOutput({
        narration: "Yes.",
        accusation_resolution: " lose ",
        follow_up_prompt: null,
      }).accusation_resolution,
    ).toBe("lose");
  });

  it("treats a missing judge follow-up as null", () => {
    expect(
      parseAccusationJudgeOutput({ narration: "Yes.", accusation_resolution: "win" }),
    ).toEqual({ narration: "Yes.", accusation_resolution: "win", follow_up_prompt: null });
  });
});
