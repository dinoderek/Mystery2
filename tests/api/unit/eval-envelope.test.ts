import { describe, expect, it } from "vitest";

import {
  buildEnvelope,
  combineDimension,
  countExtraAttempts,
} from "../../../evaluation/pipeline/envelope.mjs";

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

describe("countExtraAttempts", () => {
  it("returns 0 for a missing, non-array, or empty attempts list", () => {
    expect(countExtraAttempts(undefined)).toBe(0);
    expect(countExtraAttempts(null)).toBe(0);
    expect(countExtraAttempts("nope" as unknown as unknown[])).toBe(0);
    expect(countExtraAttempts([])).toBe(0);
  });

  it("returns 0 for a single attempt (no retries)", () => {
    expect(countExtraAttempts([{ attempt: 1, outcome: "ok" }])).toBe(0);
  });

  it("counts every attempt beyond the first as a retry", () => {
    expect(
      countExtraAttempts([
        { attempt: 1, outcome: "cli_fail" },
        { attempt: 2, outcome: "ok" },
      ]),
    ).toBe(1);
    expect(
      countExtraAttempts([
        { attempt: 1, outcome: "cli_fail" },
        { attempt: 2, outcome: "schema_fail" },
        { attempt: 3, outcome: "ok" },
      ]),
    ).toBe(2);
  });
});

describe("buildEnvelope summary", () => {
  const base = {
    runId: "r1",
    startedAt: "2026-05-31T00:00:00.000Z",
    endedAt: "2026-05-31T00:01:00.000Z",
    specDir: "evaluation/specs/001",
    blueprintPath: "/tmp/blueprint.json",
    generation: null,
    mechanical: [],
    dimensions: [],
  };

  it("tallies mechanical pass/fail counts", () => {
    const mechanical = [
      { id: "brief_schema_valid", kind: "mechanical", status: "pass", details: null },
      { id: "blueprint_schema_valid", kind: "mechanical", status: "pass", details: null },
      { id: "no_orphan_clues", kind: "mechanical", status: "fail", details: {} },
    ];
    const envelope = buildEnvelope({ ...base, mechanical });
    expect(envelope.summary.mechanical).toEqual({ pass: 2, fail: 1 });
  });

  it("tallies dimension pass/fail/error/skipped counts", () => {
    const dimensions = [
      { id: "a", overall: "pass" },
      { id: "b", overall: "pass" },
      { id: "c", overall: "fail" },
      { id: "d", overall: "error" },
      { id: "e", overall: "skipped" },
      { id: "f", overall: "skipped" },
    ];
    const envelope = buildEnvelope({ ...base, dimensions });
    expect(envelope.summary.dimensions).toEqual({
      pass: 2,
      fail: 1,
      error: 1,
      skipped: 2,
    });
  });

  it("counts generation retries from generation attempts", () => {
    const generation = {
      skipped: false,
      source: "cli",
      attempts: [
        { attempt: 1, outcome: "cli_fail" },
        { attempt: 2, outcome: "cli_fail" },
        { attempt: 3, outcome: "ok" },
      ],
    };
    const envelope = buildEnvelope({ ...base, generation });
    expect(envelope.summary.retries.generate).toBe(2);
  });

  it("reports zero generation retries when generation is null or single-attempt", () => {
    expect(buildEnvelope({ ...base }).summary.retries.generate).toBe(0);

    const generation = {
      skipped: false,
      source: "cli",
      attempts: [{ attempt: 1, outcome: "ok" }],
    };
    expect(
      buildEnvelope({ ...base, generation }).summary.retries.generate,
    ).toBe(0);
  });

  it("sums judge retries across dimensions from judge attempts", () => {
    const dimensions = [
      {
        id: "a",
        overall: "pass",
        judge: {
          status: "pass",
          attempts: [
            { attempt: 1, outcome: "schema_fail" },
            { attempt: 2, outcome: "ok" },
          ],
        },
      },
      {
        id: "b",
        overall: "pass",
        judge: {
          status: "pass",
          attempts: [
            { attempt: 1, outcome: "cli_fail" },
            { attempt: 2, outcome: "cli_fail" },
            { attempt: 3, outcome: "ok" },
          ],
        },
      },
      { id: "c", overall: "pass", judge: { status: "pass", attempts: [{ attempt: 1, outcome: "ok" }] } },
    ];
    const envelope = buildEnvelope({ ...base, dimensions });
    expect(envelope.summary.retries.judge_total).toBe(3);
  });

  it("falls back to error.attempts when a dimension has no judge attempts", () => {
    const dimensions = [
      {
        id: "a",
        overall: "error",
        error: {
          stage: "judge",
          message: "gave up",
          attempts: [
            { attempt: 1, outcome: "cli_fail" },
            { attempt: 2, outcome: "cli_fail" },
          ],
        },
      },
    ];
    const envelope = buildEnvelope({ ...base, dimensions });
    expect(envelope.summary.retries.judge_total).toBe(1);
  });

  it("carries through the run's identity and payload fields", () => {
    const envelope = buildEnvelope({ ...base });
    expect(envelope.schema_version).toBe("0.3");
    expect(envelope.run_id).toBe("r1");
    expect(envelope.spec_dir).toBe("evaluation/specs/001");
    expect(envelope.blueprint_path).toBe("/tmp/blueprint.json");
    expect(envelope.run_error).toBeNull();
  });
});
