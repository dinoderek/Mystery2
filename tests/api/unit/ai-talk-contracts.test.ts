import { describe, expect, it } from "vitest";
import {
  parseAccusationStartOutput,
  parseGraphEndingOutput,
  parseGraphSearchOutput,
  parseGraphTalkOutput,
  parseTalkEndOutput,
} from "../../../packages/game-engine/src/ai-contracts.ts";

describe("talk AI output contracts", () => {
  it("shows the player quotes a model escaped twice as plain quotes, in every role", () => {
    const twice = 'Mr. Pike tips his cap. \\"Well spotted,\\" he says.';
    const plain = 'Mr. Pike tips his cap. "Well spotted," he says.';
    expect(parseTalkEndOutput({ narration: twice }).narration).toBe(plain);
    expect(parseGraphTalkOutput({ narration: twice }).narration).toBe(plain);
    expect(parseGraphSearchOutput({ narration: twice }).narration).toBe(plain);
    expect(parseAccusationStartOutput({ narration: twice }).narration).toBe(plain);
    expect(parseGraphEndingOutput({ narration: twice }).narration).toBe(plain);
    expect(parseTalkEndOutput({ narration: plain }).narration).toBe(plain);
  });

  it("accepts a talk line with nothing earned, defaulting its lists", () => {
    expect(parseGraphTalkOutput({ narration: "I was in the kitchen." })).toEqual({
      narration: "I was in the kitchen.",
      opened: [],
      answered: [],
      notebook: [],
      input_understood: true,
    });
  });

  it("filters invalid and repeated ids from what a talk line earned", () => {
    const result = parseGraphTalkOutput({
      narration: "Some narration.",
      opened: ["valid-id", "", 42, null, "valid-id"],
      answered: ["another-valid"],
    });
    expect(result.opened).toEqual(["valid-id"]);
    expect(result.answered).toEqual(["another-valid"]);
  });

  it("earns nothing on a talk line that was not understood", () => {
    expect(
      parseGraphTalkOutput({
        narration: "Sorry — what?",
        opened: ["gate"],
        answered: ["answer"],
        notebook: [{ id: "answer", line: "A line." }],
        input_understood: false,
      }),
    ).toEqual({ narration: "Sorry — what?", opened: [], answered: [], notebook: [], input_understood: false });
  });

  it("rejects a notebook entry without an id or a line", () => {
    expect(() => parseGraphTalkOutput({ narration: "Hm.", notebook: [{ id: "clue" }] })).toThrow("notebook line");
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
    expect(() => parseGraphTalkOutput({})).toThrow("narration");
    expect(() => parseGraphTalkOutput({ narration: "" })).toThrow("narration");
    expect(() => parseTalkEndOutput({ narration: null })).toThrow("narration");
  });
});
