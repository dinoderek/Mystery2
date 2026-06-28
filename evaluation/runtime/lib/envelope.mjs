// Builders for the two persisted artifacts: interaction.json (raw capture) and
// result.json (judges over a capture). Kept separate so judging never mutates
// or risks the raw data, and so judges can be re-run from a stored interaction.
//
// A case evaluates ONE action against fixed prior state, so the capture records
// `given` (the exact prior state + history) and `action` (the event under test)
// for full reproducibility, plus the single `response`.

export const SCHEMA_VERSION = "0.2";

/**
 * The raw, judge-independent capture. Written before any judge runs.
 */
export function buildInteraction({
  runId,
  startedAt,
  endedAt,
  testCase,
  backend,
  model,
  blueprintPath,
  targetAge,
  response,
  timing,
}) {
  return {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    started_at: startedAt,
    ended_at: endedAt,
    case_id: testCase.id,
    backend,
    model,
    blueprint_path: blueprintPath,
    target_age: targetAge,
    given: testCase.given,
    action: testCase.action,
    response,
    timing,
  };
}

/**
 * Judges over an interaction. `judgeResults` is the array returned by the
 * judges; the summary tallies pass/fail/error.
 */
export function buildResult({ interaction, judgeResults, interactionRef = "interaction.json" }) {
  const summary = { pass: 0, fail: 0, error: 0 };
  for (const judge of judgeResults) {
    if (judge.status === "pass") summary.pass += 1;
    else if (judge.status === "fail") summary.fail += 1;
    else summary.error += 1;
  }
  return {
    schema_version: SCHEMA_VERSION,
    run_id: interaction.run_id,
    interaction_ref: interactionRef,
    case_id: interaction.case_id,
    backend: interaction.backend,
    model: interaction.model,
    judges: judgeResults,
    summary: { judges: summary },
  };
}
