// Recognising the login's usage limit in a failed call's output. The texts
// are what the Claude CLI builds for the limit (`You've hit your <limit>`,
// with ` · resets <time>` when it knows), the one it gives with no credit
// left, and the one earlier versions gave.

import { describe, expect, it } from "vitest";

import { usageLimitMessage } from "../../../evaluation/core/usage-limit.ts";

const LIMIT = "You've hit your 5-hour limit · resets 3pm (Europe/London)";

function event(result: string, isError = true): string {
  return JSON.stringify({ type: "result", subtype: "success", is_error: isError, num_turns: 1, result, total_cost_usd: 0 });
}

describe("usageLimitMessage", () => {
  it("reads the error result event in a stream file", () => {
    const stream = `${JSON.stringify({ type: "system", subtype: "init" })}\n${event(LIMIT)}\n`;
    expect(usageLimitMessage({ stdout: "", stderr: "", stream })).toBe(LIMIT);
  });

  it("reads the error envelope printed under --output-format json", () => {
    expect(usageLimitMessage({ stdout: event("You're out of usage credits · resets Dec 1"), stderr: "", stream: "" })).toBe(
      "You're out of usage credits · resets Dec 1",
    );
  });

  it("reads a plain line on stderr, in the CLI's current and earlier wording", () => {
    expect(usageLimitMessage({ stdout: "", stderr: "Error: something\nYou've hit your weekly limit\n", stream: "" })).toBe("You've hit your weekly limit");
    expect(usageLimitMessage({ stdout: "", stderr: "Claude AI usage limit reached|1760000000\n", stream: "" })).toBe(
      "Claude AI usage limit reached|1760000000",
    );
  });

  it("reads an organisation's credits running out", () => {
    for (const said of [
      "Your organization is out of usage credits. Contact your admin to add more.",
      "Your organization's usage credit cap is reached for this period.",
      "Your organization's usage credits are capped or used up right now.",
      "Your org is out of usage \u00b7 add funds to continue",
    ]) {
      expect(usageLimitMessage({ stdout: event(said), stderr: "", stream: "" }), said).toBe(said);
    }
  });

  it("never reads stdout's plain text, which may be the model's answer", () => {
    expect(usageLimitMessage({ stdout: "The narrator says:\nYou've hit your limit, little detective!\n", stderr: "", stream: "" })).toBeNull();
  });

  it("is null for any other failure, and for an answer that is not an error", () => {
    expect(usageLimitMessage({ stdout: event("Not logged in · Please run /login"), stderr: "exit 1", stream: "{not json" })).toBeNull();
    expect(usageLimitMessage({ stdout: "", stderr: "", stream: event(LIMIT, false) })).toBeNull();
    expect(usageLimitMessage({ stdout: JSON.stringify({ type: "result", is_error: true, result: 7 }), stderr: "", stream: "null\n" })).toBeNull();
    expect(usageLimitMessage({ stdout: "", stderr: "", stream: "" })).toBeNull();
  });
});
