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

  it("accepts valid talk-conversation output", () => {
    expect(
      parseTalkConversationOutput({
        narration: "I was in the kitchen when the cookie jar opened.",
      }),
    ).toEqual({
      narration: "I was in the kitchen when the cookie jar opened.",
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
