export function buildJudgePrompt(blueprint) {
  return [
    "You are grading a children's mystery blueprint.",
    "Return strict JSON only.",
    "Score coherence_fairness, spoiler_safety, age_fit, and image_readiness from 0 to 5.",
    "Include blocking_findings, advisory_findings, citations, and promotion_recommendation.",
    JSON.stringify({
      title: blueprint.metadata.title,
      one_liner: blueprint.metadata.one_liner,
      target_age: blueprint.metadata.target_age,
      evidence: blueprint.evidence.map((item) => ({
        evidence_key: item.evidence_key,
        player_text: item.player_text,
        essential: item.essential,
      })),
      visual: blueprint.metadata.visual,
    }),
  ].join("\n\n");
}
