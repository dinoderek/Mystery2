// Result envelope for a trace-evaluation run.
//
// Shares the blueprint pipeline's per-dimension semantics by reusing
// combineDimension() (pass/fail/error/skipped rules), but the top-level shape
// is trace-oriented: it describes the played session under evaluation rather
// than a generated blueprint. The summary reducer mirrors the blueprint
// envelope so consumers can read both the same way.

export { combineDimension } from "../../pipeline/envelope.mjs";

export const TRACE_ENVELOPE_VERSION = "trace-eval/0.1";

function countExtraAttempts(attempts) {
  if (!Array.isArray(attempts) || attempts.length <= 1) return 0;
  return attempts.length - 1;
}

export function buildTraceEnvelope({
  runId,
  startedAt,
  endedAt,
  tracePath,
  sessionId,
  blueprintId,
  extraction,
  reconstruction,
  mechanical,
  dimensions,
  runError = null,
  timing = null,
}) {
  const judgeTotalRetries = dimensions.reduce(
    (acc, d) => acc + countExtraAttempts(d.judge?.attempts ?? d.error?.attempts),
    0,
  );

  const summary = {
    mechanical: {
      pass: mechanical.filter((c) => c.status === "pass").length,
      fail: mechanical.filter((c) => c.status === "fail").length,
    },
    dimensions: {
      pass: dimensions.filter((d) => d.overall === "pass").length,
      fail: dimensions.filter((d) => d.overall === "fail").length,
      error: dimensions.filter((d) => d.overall === "error").length,
      skipped: dimensions.filter((d) => d.overall === "skipped").length,
    },
    retries: { judge_total: judgeTotalRetries },
  };

  return {
    schema_version: TRACE_ENVELOPE_VERSION,
    run_id: runId,
    started_at: startedAt,
    ended_at: endedAt,
    trace_path: tracePath,
    session_id: sessionId,
    blueprint_id: blueprintId,
    extraction,
    reconstruction,
    mechanical,
    dimensions,
    run_error: runError,
    summary,
    timing,
  };
}
