// Shared game-master judge layer: the verdict rule.
//
// The game-master judges (briefs and schemas in this directory, listed in
// evaluation/core/registry.ts) are subject-agnostic: they are written against
// the projection in subject.mjs, so the SAME brief and the SAME output schema
// grade a whole played game (evaluation/trace) and a single replayed turn
// (evaluation/runtime). Their registry entries declare the `major_findings`
// verdict rule that resolveVerdict applies.

/**
 * The shared pass/fail rule, applied to every judge in this battery: a verdict
 * fails iff the judge reported at least one `major` finding. The model also
 * states a `verdict`; when the two disagree the findings win, because a model
 * that lists a major defect and then says "pass" is contradicting its own
 * evidence. Disagreements are surfaced, not silently resolved.
 */
export function resolveVerdict(data) {
  const findings = Array.isArray(data.findings) ? data.findings : [];
  const majors = findings.filter((f) => f?.severity === "major");
  const status = majors.length > 0 ? "fail" : "pass";
  return {
    status,
    major_count: majors.length,
    minor_count: findings.length - majors.length,
    model_verdict: data.verdict ?? null,
    verdict_disagreement: data.verdict ? data.verdict !== status : false,
  };
}
