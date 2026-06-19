import { describe, expect, it } from "vitest";

import {
  TRACE_ENVELOPE_VERSION,
  buildTraceEnvelope,
  combineDimension,
} from "../../../evaluation/trace/lib/envelope.mjs";

describe("buildTraceEnvelope", () => {
  it("summarizes mechanical and dimension outcomes in a trace-shaped envelope", () => {
    const mechanical = [
      { id: "clue_accounting", kind: "mechanical", status: "pass", details: null },
      { id: "spoiler_leak", kind: "mechanical", status: "fail", details: {} },
    ];
    const dimensions = [
      combineDimension({ id: "gm_fabrication", analyzer: null, judge: { kind: "judge", status: "pass", attempts: [{ attempt: 1, outcome: "ok" }] }, error: null }),
    ];

    const envelope = buildTraceEnvelope({
      runId: "run-1",
      startedAt: "2026-06-02T00:00:00Z",
      endedAt: "2026-06-02T00:01:00Z",
      tracePath: "/tmp/trace.json",
      sessionId: "sess-1",
      blueprintId: "bp-1",
      extraction: { skipped: true, source: "preexisting" },
      reconstruction: { turns: 9, context_errors: 0 },
      mechanical,
      dimensions,
      timing: null,
    });

    expect(envelope.schema_version).toBe(TRACE_ENVELOPE_VERSION);
    expect(envelope.session_id).toBe("sess-1");
    expect(envelope.summary.mechanical).toEqual({ pass: 1, fail: 1 });
    expect(envelope.summary.dimensions).toEqual({ pass: 1, fail: 0, error: 0, skipped: 0 });
    expect(envelope.summary.retries).toEqual({ judge_total: 0 });
  });

  it("counts judge retries from attempts", () => {
    const dimensions = [
      combineDimension({
        id: "gm_fabrication",
        analyzer: null,
        judge: { kind: "judge", status: "pass", attempts: [{ attempt: 1, outcome: "schema_fail" }, { attempt: 2, outcome: "ok" }] },
        error: null,
      }),
    ];
    const envelope = buildTraceEnvelope({
      runId: "r", startedAt: "a", endedAt: "b", tracePath: null, sessionId: null, blueprintId: null,
      extraction: null, reconstruction: null, mechanical: [], dimensions, timing: null,
    });
    expect(envelope.summary.retries.judge_total).toBe(1);
  });
});
