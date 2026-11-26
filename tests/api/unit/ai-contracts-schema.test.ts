import { describe, expect, it } from "vitest";
import {
  type AIRoleName,
  parseAccusationStartOutput,
  parseGraphAccusationOutput,
  parseGraphAccusationRoundOutput,
  parseGraphEndingOutput,
  parseGraphSearchOutput,
  parseGraphTalkOutput,
  parseOneLinerOutput,
  parseTalkEndOutput,
  roleOutputJsonSchema,
} from "../../../packages/game-engine/src/ai-contracts.ts";

// The smallest output that satisfies each role's JSON Schema. If the schema and
// the parser drifted apart, one of these would be asked for and then refused.
const MINIMAL_OUTPUTS: Record<
  AIRoleName,
  { fields: string[]; sample: Record<string, unknown>; parse: (value: unknown) => unknown }
> = {
  talk_end: {
    fields: ["narration"],
    sample: { narration: "Bye." },
    parse: parseTalkEndOutput,
  },
  accusation_start: {
    fields: ["narration"],
    sample: { narration: "Really? Who did it?" },
    parse: parseAccusationStartOutput,
  },
  graph_talk: {
    fields: ["narration", "opened", "answered", "notebook", "input_understood"],
    sample: { narration: "Hello.", opened: [], answered: [], notebook: [], input_understood: true },
    parse: parseGraphTalkOutput,
  },
  graph_search: {
    fields: ["narration", "revealed_clue_id", "costs_turn", "input_understood", "notebook"],
    sample: { narration: "Dust.", revealed_clue_id: null, costs_turn: true, input_understood: true, notebook: [] },
    parse: parseGraphSearchOutput,
  },
  graph_accusation: {
    fields: ["accused_character_id", "cited_clue_ids"],
    sample: { accused_character_id: null, cited_clue_ids: [] },
    parse: parseGraphAccusationOutput,
  },
  graph_accusation_round: {
    fields: ["narration"],
    sample: { narration: "Not yet. Which clue shows it?" },
    parse: parseGraphAccusationRoundOutput,
  },
  graph_ending: {
    fields: ["narration"],
    sample: { narration: "Case closed." },
    parse: parseGraphEndingOutput,
  },
  one_liner: {
    fields: ["lines"],
    sample: { lines: [{ id: "case-a", line: "Who took the cookies?" }] },
    parse: (value) => parseOneLinerOutput(value, ["case-a"]),
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
    const search = roleOutputJsonSchema("graph_search").properties as Record<string, unknown>;
    expect(search.revealed_clue_id).toEqual({
      anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
    });

    const accusation = roleOutputJsonSchema("graph_accusation").properties as Record<string, unknown>;
    expect(accusation.accused_character_id).toEqual({
      anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
    });
  });
});

describe("role output parsing tolerance", () => {
  it("rejects anything but an object", () => {
    expect(() => parseTalkEndOutput(null)).toThrow(
      "Invalid AI talk_end output: expected object",
    );
    expect(() => parseTalkEndOutput(["narration"])).toThrow("expected object");
  });

  it("names the role and field in errors", () => {
    expect(() => parseAccusationStartOutput({ narration: " " })).toThrow(
      'Invalid AI accusation_start output: "narration" must be a non-empty string',
    );
    expect(() => parseGraphSearchOutput({ narration: "Hm.", revealed_clue_id: 42 })).toThrow(
      '"revealed_clue_id" must be a non-empty string or null',
    );
  });

  it("trims narration and rejects whitespace-only narration", () => {
    expect(parseTalkEndOutput({ narration: "  Bye.  " })).toEqual({ narration: "Bye." });
    expect(() => parseTalkEndOutput({ narration: "   " })).toThrow("narration");
  });

  it("falls back to the default when a flag is not a boolean", () => {
    expect(
      parseGraphSearchOutput({ narration: "Dust.", costs_turn: "no", input_understood: "yes" }),
    ).toEqual({
      narration: "Dust.",
      revealed_clue_id: null,
      costs_turn: true,
      input_understood: true,
      notebook: [],
    });
  });

  it("ignores an invalid clue id on a search it did not understand", () => {
    expect(
      parseGraphSearchOutput({ narration: "What?", revealed_clue_id: 42, input_understood: false }),
    ).toEqual({
      narration: "What?",
      revealed_clue_id: null,
      costs_turn: false,
      input_understood: false,
      notebook: [],
    });
  });
});

describe("the one_liner contract", () => {
  const ids = ["case-a", "case-b"];

  it("parses one line per case id asked about, dropping any other", () => {
    const lines = parseOneLinerOutput({
      lines: [
        { id: "case-b", line: "A clock stopped at noon." },
        { id: "case-x", line: "Not on the menu." },
        { id: "case-a", line: '  Who took the \\"cookies\\"?  ' },
      ],
    }, ids);
    expect([...lines.entries()]).toEqual([
      ["case-b", "A clock stopped at noon."],
      ["case-a", 'Who took the "cookies"?'],
    ]);
  });

  it("refuses an output that leaves a case without a line", () => {
    expect(() => parseOneLinerOutput({ lines: [{ id: "case-a", line: "Who?" }] }, ids)).toThrow("no line for case case-b");
  });

  it("refuses two lines for one case, or a blank one", () => {
    expect(() => parseOneLinerOutput({ lines: [{ id: "case-a", line: "One." }, { id: "case-a", line: "Two." }, { id: "case-b", line: "B." }] }, ids))
      .toThrow("two lines for case case-a");
    expect(() => parseOneLinerOutput({ lines: [{ id: "case-a", line: " " }, { id: "case-b", line: "B." }] }, ids)).toThrow("non-empty");
    expect(() => parseOneLinerOutput({}, ids)).toThrow('"lines" must be a list');
  });
});
