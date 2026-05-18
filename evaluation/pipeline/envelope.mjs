// Result envelope shape used for run output JSON.
//
// {
//   schema_version: "0.2",
//   run_id: string,
//   started_at, ended_at: ISO 8601 strings,
//   spec_dir: relative path to the spec directory,
//   blueprint_path: relative path to the blueprint used (null if generation failed),
//   generation: {
//     skipped: bool,
//     source: "cli" | "preexisting",
//     duration_ms?: number,
//     attempts?: [ { attempt, outcome: "ok"|"cli_fail", duration_ms, error? } ]
//   } | null,
//   mechanical: [ { id, kind: "mechanical", status, details } ],
//   dimensions: [
//     {
//       id,
//       analyzer?: { status, details },
//       judge?: {
//         status, reasoning, raw,
//         attempts?: [ { attempt, outcome: "ok"|"cli_fail"|"schema_fail", duration_ms, error? } ]
//       },
//       overall: "pass" | "fail" | "error" | "skipped",
//       error?: { stage, message, attempts? }
//     }
//   ],
//   run_error: { stage, message } | null,
//   summary: {
//     mechanical: { pass, fail },
//     dimensions: { pass, fail, error, skipped },
//     retries: { generate, judge_total }
//   }
// }

export function buildEnvelope({
  runId,
  startedAt,
  endedAt,
  specDir,
  blueprintPath,
  generation,
  mechanical,
  dimensions,
  runError = null,
}) {
  const generateRetries = countExtraAttempts(generation?.attempts);
  const judgeTotalRetries = dimensions.reduce((acc, d) => {
    return acc + countExtraAttempts(d.judge?.attempts ?? d.error?.attempts);
  }, 0);

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
    retries: {
      generate: generateRetries,
      judge_total: judgeTotalRetries,
    },
  };

  return {
    schema_version: "0.2",
    run_id: runId,
    started_at: startedAt,
    ended_at: endedAt,
    spec_dir: specDir,
    blueprint_path: blueprintPath,
    generation,
    mechanical,
    dimensions,
    run_error: runError,
    summary,
  };
}

function countExtraAttempts(attempts) {
  if (!Array.isArray(attempts) || attempts.length <= 1) return 0;
  return attempts.length - 1;
}

export function combineDimension({ id, analyzer, judge, error }) {
  if (error) {
    return { id, analyzer, judge, overall: "error", error };
  }
  const sub = [];
  if (analyzer) sub.push(analyzer.status);
  if (judge) sub.push(judge.status);
  if (sub.length === 0) {
    return {
      id,
      analyzer,
      judge,
      overall: "error",
      error: { stage: "compose", message: "Dimension produced neither analyzer nor judge result." },
    };
  }
  const considered = sub.filter((s) => s !== "skipped");
  if (considered.length === 0) {
    return { id, analyzer, judge, overall: "skipped" };
  }
  const overall = considered.every((s) => s === "pass") ? "pass" : "fail";
  return { id, analyzer, judge, overall };
}
