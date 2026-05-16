// Coherence analyzer (deterministic part).
//
// Cheap structural consistency checks the schema's superRefine doesn't
// already do:
//  - Every character has at least one actual_action (also schema-enforced,
//    but we report it as a coherence check for completeness).
//  - actual_actions sequences form a dense 1..N range (schema only enforces
//    unique + ascending). Gaps don't break the schema but suggest the
//    generator dropped a sequence.
//  - ground_truth.timeline is non-empty.
//  - When a clue has role "alibi_knowledge" / "witness_testimony" /
//    "motive_knowledge", the source character's actual_actions overlap in
//    time with the target's (i.e., they could plausibly know).
//    For the skeleton: we just verify the target character exists, which
//    the schema already enforces; we leave time-overlap checking to the
//    judge.

export function analyze({ blueprint }) {
  const issues = [];

  if (blueprint.ground_truth.timeline.length === 0) {
    issues.push({
      kind: "empty_timeline",
      description: "ground_truth.timeline is empty.",
    });
  }

  for (const ch of blueprint.world.characters) {
    const sequences = ch.actual_actions.map((a) => a.sequence).sort((a, b) => a - b);
    if (sequences.length === 0) {
      issues.push({
        kind: "no_actions",
        character_id: ch.id,
        description: "Character has no actual_actions.",
      });
      continue;
    }
    const expected = Array.from({ length: sequences.length }, (_, i) => i + 1);
    const dense = sequences.every((s, i) => s === expected[i]);
    if (!dense) {
      issues.push({
        kind: "non_dense_sequences",
        character_id: ch.id,
        description: "actual_actions sequence numbers are not a dense 1..N range.",
        sequences,
      });
    }
  }

  const culprit = blueprint.world.characters.find((c) => c.is_culprit);
  if (culprit && culprit.actual_actions.length === 0) {
    issues.push({
      kind: "culprit_has_no_actions",
      character_id: culprit.id,
      description: "The culprit has no authored actual_actions to ground the timeline.",
    });
  }

  return {
    status: issues.length === 0 ? "pass" : "fail",
    details: { issues },
  };
}
