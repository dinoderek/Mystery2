/**
 * Runs the id checks a registry entry declares on a judge's answer: that every
 * id it cites exists in the case it judged, that it covers what it must, and
 * that it repeats nothing it must not. A schema cannot say these things,
 * because they depend on the case.
 */

import { stepIds } from "../blueprint/player-view.ts";
import type { IdCheck, IdSetName } from "./registry.ts";

/** A clue-graph case's maps, keyed by id (`docs/clue-graph.md`). */
interface Case {
  clues?: Record<string, unknown>;
  conclusions?: Record<string, unknown>;
  characters?: Record<string, unknown>;
  locations?: Record<string, unknown>;
}

interface Found {
  /** Where the value sits in the answer, with indexes: `paths[2].id`. */
  location: string;
  value: unknown;
}

/** The values at `at` in `root`, each with where it was found. `[]` visits every item of an array. */
function collect(root: unknown, at: string): Found[] {
  let level: Found[] = [{ location: "", value: root }];
  for (const token of at.split(".")) {
    const each = token.endsWith("[]");
    const key = each ? token.slice(0, -2) : token;
    const next: Found[] = [];
    for (const { location, value } of level) {
      if (value === null || typeof value !== "object") continue;
      const child = (value as Record<string, unknown>)[key];
      const base = location ? `${location}.${key}` : key;
      if (!each) next.push({ location: base, value: child });
      else if (Array.isArray(child)) child.forEach((item, i) => next.push({ location: `${base}[${i}]`, value: item }));
    }
    level = next;
  }
  return level;
}

/** The keys of one of a clue-graph case's maps. */
function caseKeys(map: Record<string, unknown> | undefined): string[] {
  return map && typeof map === "object" ? Object.keys(map) : [];
}

function caseSet(name: IdSetName, subject: Case): Set<string> {
  switch (name) {
    case "case_clue_ids":
      return new Set(caseKeys(subject.clues));
    case "case_conclusion_ids":
      return new Set(caseKeys(subject.conclusions));
    case "case_character_ids":
      return new Set(caseKeys(subject.characters));
    case "case_ids":
      // `opening` stands for the opening's facts, as a lead and as a prompt.
      return new Set([...[subject.clues, subject.conclusions, subject.characters, subject.locations].flatMap(caseKeys), "opening"]);
    case "case_step_ids":
      return stepIds(subject);
  }
}

const listed = (ids: Set<string>) => [...ids].join(", ") || "(none)";

/** Every way `answer` breaks the declared rules against `subject`, the case it judged; empty when it breaks none. */
export function checkAnswerIds(rules: readonly IdCheck[], answer: unknown, subject: unknown): string[] {
  const judged = (subject ?? {}) as Case;
  return rules.flatMap((rule) => {
    const members = caseSet(rule.set, judged);
    const issues: string[] = [];
    const seen = new Set<string>();
    for (const { location, value } of collect(answer, rule.at)) {
      const id = String(value);
      if (!members.has(id)) issues.push(`${location} "${id}" is not a ${rule.label} (valid: ${listed(members)})`);
      if (rule.unique && seen.has(id)) issues.push(`${location} "${id}" appears more than once`);
      seen.add(id);
    }
    if (rule.covers) {
      for (const id of members) if (!seen.has(id)) issues.push(`${rule.at} is missing an entry for ${rule.label} "${id}"`);
    }
    return issues;
  });
}
