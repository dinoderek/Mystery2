import type { MysteryStructure } from "./mystery-structure-schema.ts";

/** Private derived state. Claims establish that something was said, never its truth. */
export function evaluateMysteryStructure(
  structure: MysteryStructure,
  discovered: Iterable<string>,
) {
  const available = new Set<string>();
  const facts = new Set(structure.opening.known_fact_ids);
  const claims = new Set<string>();
  for (const id of discovered) {
    const clue = Object.hasOwn(structure.nodes, id)
      ? structure.nodes[id]
      : undefined;
    if (clue?.kind !== "clue") continue;
    available.add(id);
    clue.establishes_fact_ids.forEach((fact) => facts.add(fact));
    clue.reports_claim_ids.forEach((claim) => claims.add(claim));
  }
  const supported = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, rule] of Object.entries(structure.nodes)) {
      if (rule.kind !== "rule" || supported.has(id)) continue;
      const ready =
        rule.operator === "AND"
          ? rule.children.every((child) => available.has(child))
          : rule.children.some((child) => available.has(child));
      if (!ready) continue;
      available.add(id);
      supported.add(id);
      changed = true;
      rule.concludes_fact_ids.forEach((fact) => facts.add(fact));
    }
  }
  return {
    supported_rule_ids: [...supported],
    known_fact_ids: [...facts],
    heard_claim_ids: [...claims],
    solution_supported: structure.solution.rule_ids.some((id) =>
      supported.has(id),
    ),
  };
}
