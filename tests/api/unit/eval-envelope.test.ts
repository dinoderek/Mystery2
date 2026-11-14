import { describe, expect, it } from "vitest";

import { combineDimension } from "../../../evaluation/pipeline/envelope.mjs";

// Minimal per-step results, matching the envelope shape (`{ status, ... }`).
const analyzer = (status: string) => ({ kind: "analyzer", status, details: null });
const judge = (
  status: string,
  attempts?: Array<{ attempt: number; outcome: string }>,
) => ({ kind: "judge", status, reasoning: "", raw: "", attempts });

describe("combineDimension", () => {
  it("marks a dimension error when a top-level error is supplied", () => {
    const err = { stage: "judge", message: "backend exploded" };
    const result = combineDimension({
      id: "solve_depth",
      analyzer: analyzer("pass"),
      judge: judge("pass"),
      error: err,
    });
    expect(result.overall).toBe("error");
    expect(result.error).toBe(err);
    // The passed-through analyzer/judge are preserved on the result.
    expect(result.analyzer).toEqual(analyzer("pass"));
    expect(result.judge).toEqual(judge("pass"));
  });

  it("passes when the analyzer alone passes (judge absent)", () => {
    const result = combineDimension({
      id: "d",
      analyzer: analyzer("pass"),
      judge: undefined,
      error: null,
    });
    expect(result.overall).toBe("pass");
  });

  it("passes when the judge alone passes (analyzer absent)", () => {
    const result = combineDimension({
      id: "d",
      analyzer: undefined,
      judge: judge("pass"),
      error: null,
    });
    expect(result.overall).toBe("pass");
  });

  it("passes when both the analyzer and judge pass", () => {
    const result = combineDimension({
      id: "d",
      analyzer: analyzer("pass"),
      judge: judge("pass"),
      error: null,
    });
    expect(result.overall).toBe("pass");
  });

  it("errors when neither an analyzer nor a judge result is produced", () => {
    const result = combineDimension({
      id: "d",
      analyzer: undefined,
      judge: undefined,
      error: null,
    });
    expect(result.overall).toBe("error");
    expect(result.error).toMatchObject({ stage: "compose" });
    expect(result.error.message).toContain("neither analyzer nor judge");
  });

  it("fails when any non-skipped sub-result fails (analyzer fails, judge passes)", () => {
    const result = combineDimension({
      id: "d",
      analyzer: analyzer("fail"),
      judge: judge("pass"),
      error: null,
    });
    expect(result.overall).toBe("fail");
  });

  it("fails when the judge fails while the analyzer passes", () => {
    const result = combineDimension({
      id: "d",
      analyzer: analyzer("pass"),
      judge: judge("fail"),
      error: null,
    });
    expect(result.overall).toBe("fail");
  });

  it("skips when every present sub-result is itself skipped", () => {
    const result = combineDimension({
      id: "d",
      analyzer: analyzer("skipped"),
      judge: judge("skipped"),
      error: null,
    });
    expect(result.overall).toBe("skipped");
    // A skipped dimension carries no error object.
    expect(result.error).toBeUndefined();
  });

  it("ignores a skipped sub-result and passes on the remaining one", () => {
    const result = combineDimension({
      id: "d",
      analyzer: analyzer("skipped"),
      judge: judge("pass"),
      error: null,
    });
    expect(result.overall).toBe("pass");
  });

  it("ignores a skipped sub-result and fails on the remaining failing one", () => {
    const result = combineDimension({
      id: "d",
      analyzer: analyzer("pass"),
      judge: judge("skipped"),
      error: null,
    });
    // Only the analyzer (pass) is considered -> pass.
    expect(result.overall).toBe("pass");

    const failing = combineDimension({
      id: "d",
      analyzer: analyzer("fail"),
      judge: judge("skipped"),
      error: null,
    });
    expect(failing.overall).toBe("fail");
  });
});
