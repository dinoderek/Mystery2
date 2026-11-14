/**
 * Runs the id checks a registry entry declares on a judge's answer: that every
 * id, path and topic it cites exists in the blueprint it judged, that it
 * covers what it must, and that it repeats nothing it must not. A schema
 * cannot say these things, because they depend on the blueprint.
 */

import { extractPlayerFacingText } from "../checks/lib/player-text.ts";
import type { IdCheck, IdSetName } from "./registry.ts";

interface Blueprint {
  metadata?: { target_age?: unknown };
  solution_paths?: Array<{ id: string }>;
  suspect_elimination_paths?: Array<{ id: string }>;
  world?: {
    locations?: Array<{
      clues?: Array<{ id: string }>;
      sub_locations?: Array<{ clues?: Array<{ id: string }> }>;
    }>;
    characters?: Array<{ id: string; first_name?: string; is_culprit?: boolean; clues?: Array<{ id: string }> }>;
  };
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

function clueIds(blueprint: Blueprint): Set<string> {
  const ids = new Set<string>();
  for (const location of blueprint.world?.locations ?? []) {
    for (const clue of location.clues ?? []) ids.add(clue.id);
    for (const sub of location.sub_locations ?? []) for (const clue of sub.clues ?? []) ids.add(clue.id);
  }
  for (const character of blueprint.world?.characters ?? []) for (const clue of character.clues ?? []) ids.add(clue.id);
  return ids;
}

function blueprintSet(name: IdSetName, blueprint: Blueprint, context: Record<string, unknown>): Set<string> {
  const characters = blueprint.world?.characters ?? [];
  switch (name) {
    case "solution_path_ids":
      return new Set((blueprint.solution_paths ?? []).map((p) => p.id));
    case "elimination_path_ids":
      return new Set((blueprint.suspect_elimination_paths ?? []).map((p) => p.id));
    case "clue_ids":
      return clueIds(blueprint);
    case "character_ids":
      return new Set(characters.map((c) => c.id));
    case "non_culprit_ids":
      return new Set(characters.filter((c) => !c.is_culprit).map((c) => c.id));
    case "player_text_paths":
      return new Set((extractPlayerFacingText(blueprint) as Array<{ path: string }>).map((s) => s.path));
    case "probe_topics":
      return new Set(Array.isArray(context.probe_topics) ? (context.probe_topics as string[]) : []);
  }
}

const isBlank = (value: unknown) => value === null || value === undefined || value === "";
const listed = (ids: Set<string>) => [...ids].join(", ") || "(none)";

type RefCheck = Extract<IdCheck, { kind: "ref" }>;

function checkRef(rule: RefCheck, answer: unknown, blueprint: Blueprint, context: Record<string, unknown>): string[] {
  const members =
    typeof rule.set === "string"
      ? blueprintSet(rule.set, blueprint, context)
      : new Set(collect(answer, rule.set.answer).map((f) => String(f.value)));
  if (rule.skipIfEmpty && members.size === 0) return [];

  const issues: string[] = [];
  const seen = new Set<string>();
  for (const { location, value } of collect(answer, rule.at)) {
    if (rule.optional && isBlank(value)) continue;
    const id = String(value);
    if (!members.has(id)) issues.push(`${location} "${id}" is not a ${rule.label} (valid: ${listed(members)})`);
    if (rule.unique && seen.has(id)) issues.push(`${location} "${id}" appears more than once`);
    seen.add(id);
  }
  if (rule.covers) {
    for (const id of members) if (!seen.has(id)) issues.push(`${rule.at} is missing an entry for ${rule.label} "${id}"`);
  }
  return issues;
}

function checkFieldOf(rule: Extract<IdCheck, { kind: "field_of" }>, answer: unknown, blueprint: Blueprint): string[] {
  const names = new Map((blueprint.world?.characters ?? []).map((c) => [c.id, c.first_name]));
  const issues: string[] = [];
  for (const { location, value } of collect(answer, rule.at)) {
    const item = (value ?? {}) as Record<string, unknown>;
    const id = String(item[rule.id]);
    if (names.has(id) && item[rule.field] !== names.get(id)) {
      issues.push(`${location}.${rule.field} for "${id}" is "${String(item[rule.field])}" but the blueprint says "${names.get(id)}"`);
    }
  }
  return issues;
}

function checkNonemptyWhen(rule: Extract<IdCheck, { kind: "nonempty_when" }>, answer: unknown): string[] {
  const issues: string[] = [];
  for (const { location, value } of collect(answer, rule.at)) {
    const item = (value ?? {}) as Record<string, unknown>;
    const filled = Array.isArray(item[rule.field]) && (item[rule.field] as unknown[]).length > 0;
    if (item[rule.when.field] === rule.when.equals && !filled) {
      issues.push(`${location} is a ${rule.when.equals} but ${rule.field} is empty (${rule.hint})`);
    }
  }
  return issues;
}

function checkEquals(rule: Extract<IdCheck, { kind: "equals" }>, answer: unknown, blueprint: Blueprint): string[] {
  const expected = blueprint.metadata?.target_age;
  return collect(answer, rule.at)
    .filter(({ value }) => value !== expected)
    .map(({ location, value }) => `${location} ${String(value)} does not match blueprint.metadata.${rule.to} (${String(expected)})`);
}

/** Every way `answer` breaks the declared rules against `blueprint`; empty when it breaks none. */
export function checkAnswerIds(
  rules: readonly IdCheck[],
  answer: unknown,
  blueprint: unknown,
  context: Record<string, unknown> = {},
): string[] {
  const bp = (blueprint ?? {}) as Blueprint;
  return rules.flatMap((rule) => {
    switch (rule.kind) {
      case "ref":
        return checkRef(rule, answer, bp, context);
      case "equals":
        return checkEquals(rule, answer, bp);
      case "field_of":
        return checkFieldOf(rule, answer, bp);
      case "nonempty_when":
        return checkNonemptyWhen(rule, answer);
    }
  });
}
