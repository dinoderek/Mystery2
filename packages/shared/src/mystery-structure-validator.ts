import { z } from "zod";
import {
  MysteryStructureSchema,
  type MysteryStructure,
  type MysteryStructureNode,
} from "./mystery-structure-schema.ts";
import { hasBudgetedSolution } from "./mystery-structure-solvability.ts";

type Kind = MysteryStructureNode["kind"];
type IssuePath = (string | number)[];
type Report = (path: IssuePath, message: string) => void;
type References = Record<string, readonly Kind[]>;
const ENTITY_KINDS = ["character", "location", "object", "event"] as const;
const NODE_REFERENCES: Record<Kind, References> = {
  character: {
    location_id: ["location"],
    knows_fact_ids: ["fact"],
    believes_claim_ids: ["claim"],
  },
  location: {},
  object: {},
  event: {
    character_ids: ["character"],
    location_id: ["location"],
    object_ids: ["object"],
    after_event_ids: ["event"],
    caused_by_event_ids: ["event"],
  },
  fact: { about_ids: ENTITY_KINDS },
  claim: { character_id: ["character"], fact_id: ["fact"] },
  clue: {
    establishes_fact_ids: ["fact"],
    reports_claim_ids: ["claim"],
    origin_event_ids: ["event"],
  },
  rule: { children: ["clue", "rule"], concludes_fact_ids: ["fact"] },
};

function checkReferences(mystery: MysteryStructure, report: Report): boolean {
  const nodes = new Map(Object.entries(mystery.nodes));
  let valid = true;
  const check = (object: object, fields: References, path: IssuePath) => {
    for (const [field, kinds] of Object.entries(fields)) {
      const value: unknown = Reflect.get(object, field);
      if (value === undefined) continue;
      const references: string[] =
        typeof value === "string" ? [value] : (value as string[]);
      references.forEach((reference, index) => {
        const target = nodes.get(reference);
        if (target && kinds.includes(target.kind)) return;
        valid = false;
        report(
          [...path, field, ...(Array.isArray(value) ? [index] : [])],
          `Reference "${reference}" must name an existing ${kinds.join(" or ")} node`,
        );
      });
    }
  };
  check(
    mystery.opening,
    { starting_location_id: ["location"], known_fact_ids: ["fact"] },
    ["opening"],
  );
  check(
    mystery.solution,
    {
      culprit_id: ["character"],
      event_ids: ["event"],
      motive_fact_id: ["fact"],
      rule_ids: ["rule"],
    },
    ["solution"],
  );
  mystery.red_herrings.forEach((lead, index) =>
    check(
      lead,
      {
        hypothesis_fact_id: ["fact"],
        lead_clue_ids: ["clue"],
        resolution_rule_id: ["rule"],
      },
      ["red_herrings", index],
    ),
  );
  mystery.eliminations.forEach((path, index) =>
    check(
      path,
      {
        character_id: ["character"],
        rule_id: ["rule"],
      },
      ["eliminations", index],
    ),
  );
  for (const [id, node] of nodes) {
    const path = ["nodes", id];
    check(node, NODE_REFERENCES[node.kind], path);
    if (node.kind !== "clue") continue;
    check(
      node.source,
      { location_id: ["location"], character_id: ["character"] },
      [...path, "source"],
    );
    if (node.requires)
      check(node.requires, { clue_ids: ["clue"] }, [...path, "requires"]);
  }
  return valid;
}

/** Dependencies first; iterative so a long authored chain cannot overflow the stack. */
function dependencyOrder(
  graph: Map<string, string[]>,
  report: Report,
  label: string,
): string[] {
  const remaining = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const [id, dependencies] of graph) {
    remaining.set(id, dependencies.length);
    for (const dependency of dependencies) {
      const list = dependents.get(dependency) ?? [];
      list.push(id);
      dependents.set(dependency, list);
    }
  }
  const order = [...remaining]
    .filter(([, count]) => count === 0)
    .map(([id]) => id);
  for (let index = 0; index < order.length; index++) {
    for (const dependent of dependents.get(order[index]) ?? []) {
      const count = remaining.get(dependent)! - 1;
      remaining.set(dependent, count);
      if (count === 0) order.push(dependent);
    }
  }
  if (order.length !== graph.size) {
    const blocked = [...remaining].find(([, count]) => count > 0)![0];
    report(
      ["nodes", blocked],
      `${label} dependencies contain a cycle (including self references)`,
    );
  }
  return order;
}

function checkChronology(mystery: MysteryStructure, report: Report): void {
  const positions = new Map(
    mystery.solution.event_ids.map((id, index) => [id, index]),
  );
  for (const [id, position] of positions) {
    const event = mystery.nodes[id];
    if (event.kind !== "event") continue;
    for (const predecessor of [
      ...event.after_event_ids,
      ...event.caused_by_event_ids,
    ]) {
      const earlier = positions.get(predecessor);
      if (earlier === undefined || earlier >= position)
        report(
          ["solution", "event_ids", position],
          `Event "${predecessor}" must occur before "${id}" in solution.event_ids`,
        );
    }
  }
}

function checkConclusions(mystery: MysteryStructure, report: Report): void {
  const fact = (id: string) => {
    const node = mystery.nodes[id];
    return node.kind === "fact" ? node : undefined;
  };
  const conclusions = (id: string) => {
    const node = mystery.nodes[id];
    return node.kind === "rule" ? node.concludes_fact_ids : [];
  };
  mystery.opening.known_fact_ids.forEach((id, index) => {
    if (!fact(id)?.truth)
      report(
        ["opening", "known_fact_ids", index],
        "Opening facts must be true",
      );
  });
  if (!fact(mystery.solution.motive_fact_id)?.truth)
    report(["solution", "motive_fact_id"], "The motive fact must be true");
  mystery.solution.rule_ids.forEach((id, index) => {
    const facts = conclusions(id);
    if (!facts.includes(mystery.solution.motive_fact_id))
      report(
        ["solution", "rule_ids", index],
        `Solution rule "${id}" must conclude the motive fact`,
      );
    if (
      !facts.some((factId) => {
        const target = fact(factId);
        return (
          target?.truth &&
          target.about_ids.includes(mystery.solution.culprit_id) &&
          target.about_ids.some((about) =>
            mystery.solution.event_ids.includes(about),
          )
        );
      })
    )
      report(
        ["solution", "rule_ids", index],
        `Solution rule "${id}" must conclude a true fact about the culprit and an incident event`,
      );
  });
  mystery.red_herrings.forEach((lead, index) => {
    if (fact(lead.hypothesis_fact_id)?.truth)
      report(
        ["red_herrings", index, "hypothesis_fact_id"],
        "A red-herring hypothesis must be false",
      );
    if (!conclusions(lead.resolution_rule_id).includes(lead.hypothesis_fact_id))
      report(
        ["red_herrings", index, "resolution_rule_id"],
        "The resolution rule must conclude the red-herring hypothesis",
      );
  });
  const eliminated = new Set<string>();
  mystery.eliminations.forEach((path, index) => {
    if (
      path.character_id === mystery.solution.culprit_id ||
      eliminated.has(path.character_id)
    )
      report(
        ["eliminations", index, "character_id"],
        "Eliminations must name distinct non-culprit characters",
      );
    eliminated.add(path.character_id);
    if (
      !conclusions(path.rule_id).some((id) => {
        const target = fact(id);
        return (
          target?.truth === false &&
          target.about_ids.includes(path.character_id) &&
          target.about_ids.some((about) =>
            mystery.solution.event_ids.includes(about),
          )
        );
      })
    )
      report(
        ["eliminations", index, "rule_id"],
        "An elimination must conclude a false fact about its character and an incident event",
      );
  });
}

function checkIntegrity(mystery: MysteryStructure, issues: z.ZodIssue[]): void {
  let valid = true;
  const report: Report = (path, message) => {
    valid = false;
    issues.push({ code: z.ZodIssueCode.custom, path, message });
  };
  if (!checkReferences(mystery, report)) return;
  const events = new Map<string, string[]>();
  const clues = new Map<string, string[]>();
  const rules = new Map<string, string[]>();
  for (const [id, node] of Object.entries(mystery.nodes)) {
    if (node.kind === "event")
      events.set(id, [
        ...new Set([...node.after_event_ids, ...node.caused_by_event_ids]),
      ]);
    if (node.kind === "clue") {
      clues.set(id, node.requires?.clue_ids ?? []);
      rules.set(id, []);
    }
    if (node.kind === "rule") rules.set(id, node.children);
  }
  dependencyOrder(events, report, "Event");
  const clueOrder = dependencyOrder(clues, report, "Clue discovery");
  const ruleOrder = dependencyOrder(rules, report, "Rule");
  checkChronology(mystery, report);
  checkConclusions(mystery, report);
  if (valid && !hasBudgetedSolution(mystery, ruleOrder, clueOrder))
    report(
      ["metadata", "time_budget"],
      "No solution route fits the turn budget without a discretionary gate bypass",
    );
}

/** Throws a ZodError with field paths; never loads content or runs a model. */
export function validateMysteryStructure(value: unknown): MysteryStructure {
  const mystery = MysteryStructureSchema.parse(value);
  const issues: z.ZodIssue[] = [];
  checkIntegrity(mystery, issues);
  if (issues.length > 0) throw new z.ZodError(issues);
  return mystery;
}
