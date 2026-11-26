// Shared game-master judge layer: the case the judges read, and the verdict rule.
//
// The game-master judges (briefs and schemas in this directory, listed in
// evaluation/core/registry.ts) are subject-agnostic: they are written against
// the projection in subject.ts, so the SAME brief and the SAME output schema
// grade a whole played game (evaluation/trace) and a single replayed turn
// (evaluation/runtime). Their registry entries declare the `major_findings`
// verdict rule that resolveVerdict applies.

import type { ClueGraphCase } from "../../packages/shared/src/clue-graph-schema.ts";

/**
 * The case a game-master judge reads as its `blueprint`: the clue-graph case
 * itself, not the world view built from it. Each judged turn carries the age
 * it was narrated at (`reading_age` in `subject.ts`).
 */
export function judgedCase(world: { clue_graph: ClueGraphCase }): ClueGraphCase {
  return world.clue_graph;
}

/**
 * The shared pass/fail rule, applied to every judge in this battery: a verdict
 * fails iff the judge reported at least one `major` finding. The model also
 * states a `verdict`; when the two disagree the findings win, because a model
 * that lists a major defect and then says "pass" is contradicting its own
 * evidence. Disagreements are surfaced, not silently resolved.
 */
export function resolveVerdict(data: { findings?: unknown; verdict?: string | null }): {
  status: "pass" | "fail";
  major_count: number;
  minor_count: number;
  model_verdict: string | null;
  verdict_disagreement: boolean;
} {
  const findings = Array.isArray(data.findings) ? data.findings : [];
  const majors = findings.filter((f: { severity?: string } | null) => f?.severity === "major");
  const status = majors.length > 0 ? "fail" : "pass";
  return {
    status,
    major_count: majors.length,
    minor_count: findings.length - majors.length,
    model_verdict: data.verdict ?? null,
    verdict_disagreement: data.verdict ? data.verdict !== status : false,
  };
}

/**
 * What a result stores for a judge whose answer `resolveVerdict` decides: the
 * status, the findings it was reached from, and the counts and the model's
 * own verdict beside its reasoning.
 */
export function majorFindingsVerdict(answer: Record<string, unknown>) {
  const resolved = resolveVerdict(answer);
  return {
    status: resolved.status,
    findings: Array.isArray(answer.findings) ? (answer.findings as unknown[]) : [],
    details: {
      reasoning: answer.reasoning ?? "",
      major_count: resolved.major_count,
      minor_count: resolved.minor_count,
      model_verdict: resolved.model_verdict,
      verdict_disagreement: resolved.verdict_disagreement,
    },
  };
}
