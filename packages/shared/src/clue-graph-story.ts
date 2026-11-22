import { has, reachReason, ruleMet } from "./clue-graph-reach.ts";
import { cheapestRoute, relevantClues } from "./clue-graph-route.ts";
import {
  FIRST_WORDS_PER_LINE,
  type ClueGraphCase,
  type ClueGraphClue,
  type ClueGraphGate,
  type ClueGraphRule,
} from "./clue-graph-schema.ts";
import { sizeBounds, SIZE_COUNTS, type CountRange, type SizeCount } from "./clue-graph-sizes.ts";

/**
 * The checks that hold a generated story to fair, full play
 * (`docs/clue-graph.md`, "Validation"), and the counts its size is checked
 * on. The validator runs them once references hold; each report names the
 * field at fault.
 */

type IssuePath = (string | number)[];
type Report = (path: IssuePath, message: string) => void;

/** More than this share of clues free from the opening is a thin story. */
export const MAX_FREE_SHARE = 0.8;

/** How many culprit routes are kept; a rule with more is reported, never cut silently. */
export const MAX_ROUTES = 256;

/** One way the culprit conclusion's rule is met: the clues it names, through conclusions. */
export interface CulpritRoute {
  clues: string[];
  /** Whether the route holds the culprit's confession. */
  confession: boolean;
  /** The fewest turns it takes, or null when it does not fit the turn budget. */
  turns: number | null;
}

function parts(rule: ClueGraphRule): ClueGraphRule[] {
  return typeof rule === "string" ? [] : "all" in rule ? rule.all : rule.any;
}

/** The sets smallest first, without duplicates or supersets of another. */
function minimal(sets: Set<string>[]): Set<string>[] {
  const sorted = [...sets].sort((a, b) => a.size - b.size);
  return sorted.filter(
    (set, index) => !sorted.slice(0, index).some((smaller) => [...smaller].every((id) => set.has(id))),
  );
}

/**
 * Each set of clues that meets `rule` on its own, smallest first, supersets
 * dropped, and whether there were more than MAX_ROUTES, past which the rest
 * are left out.
 */
function ruleTerms(graph: ClueGraphCase, rule: ClueGraphRule): { terms: Set<string>[]; cut: boolean } {
  let cut = false;
  const keep = (sets: Set<string>[]) => {
    const kept = minimal(sets);
    if (kept.length > MAX_ROUTES) cut = true;
    return kept.slice(0, MAX_ROUTES);
  };
  const expand = (part: ClueGraphRule): Set<string>[] => {
    if (typeof part === "string")
      return has(graph.conclusions, part) ? expand(graph.conclusions[part].rule) : [new Set([part])];
    const each = parts(part).map(expand);
    if ("any" in part) return keep(each.flat());
    return each.reduce((left, right) => keep(left.flatMap((a) => right.map((b) => new Set([...a, ...b])))));
  };
  const terms = expand(rule);
  return { terms, cut };
}

/** Every clue a conclusion's rule names, through the conclusions it names. */
function ruleLeaves(graph: ClueGraphCase, rule: ClueGraphRule, out = new Set<string>()): Set<string> {
  if (typeof rule !== "string") parts(rule).forEach((part) => ruleLeaves(graph, part, out));
  else if (has(graph.conclusions, rule)) ruleLeaves(graph, graph.conclusions[rule].rule, out);
  else out.add(rule);
  return out;
}

function culpritOf(graph: ClueGraphCase): [string, string] {
  const [conclusion, { culprit }] = Object.entries(graph.conclusions).find(
    ([, value]) => value.culprit !== undefined,
  )!;
  return [conclusion, culprit!];
}

/**
 * The culprit's confession: the true statements the culprit gives through a
 * gate that a route to them can draw on, named or on the way.
 */
function confessions(graph: ClueGraphCase, terms: Set<string>[]): Set<string> {
  const [, culprit] = culpritOf(graph);
  const near = new Set(terms.flatMap((term) => [...term, ...relevantClues(graph, { all: [...term] })]));
  return new Set(
    [...near].filter((id) => {
      const clue = graph.clues[id];
      return (
        clue?.kind === "statement" &&
        clue.truth &&
        clue.reached.by === "gated" &&
        clue.source.character === culprit
      );
    }),
  );
}

function culpritTerms(graph: ClueGraphCase) {
  const [conclusion] = culpritOf(graph);
  return ruleTerms(graph, graph.conclusions[conclusion].rule);
}

/**
 * The routes to the culprit, each costed with the game's costs. A route is
 * without the confession when it fits never holding it, named or on the way;
 * one that fits only by holding it needs the confession.
 */
export function culpritRoutes(graph: ClueGraphCase): CulpritRoute[] {
  const { terms } = culpritTerms(graph);
  const confession = confessions(graph, terms);
  return terms.map((term) => {
    const clues = [...term];
    const plain = clues.some((id) => confession.has(id)) ? null : cheapestRoute(graph, { all: clues }, confession);
    if (plain !== null) return { clues, confession: false, turns: plain };
    return { clues, confession: true, turns: cheapestRoute(graph, { all: clues }) };
  });
}

/** The clues another clue, a conclusion or a spot depends on. */
function dependedOn(graph: ClueGraphCase): Set<string> {
  const named = new Set<string>();
  for (const conclusion of Object.values(graph.conclusions)) ruleLeaves(graph, conclusion.rule, named);
  for (const location of Object.values(graph.locations))
    location.spots.forEach((spot) => spot.revealed_by && named.add(spot.revealed_by));
  for (const [id, clue] of Object.entries(graph.clues)) {
    if (clue.kind === "evidence") continue;
    const { reached } = clue;
    if (reached.by === "seen" && reached.with) named.add(reached.with);
    if (reached.by === "asked") reached.prompted_by.forEach((prompt) => named.add(prompt));
    if (reached.by === "gated") {
      const { after = [], use, line } = reached.gate;
      after.forEach((earlier) => named.add(earlier));
      if (use) ("any" in use ? use.any : use.all).forEach((shown) => named.add(shown));
      if (line?.hinted_by) named.add(line.hinted_by);
    }
    // A retraction and what it takes back are both steps of the story.
    if (clue.kind === "statement" && clue.takes_back) {
      named.add(id);
      clue.takes_back.forEach((target) => named.add(target));
    }
  }
  return named;
}

/** A clue reached with nothing held: plain evidence, first words, a question the opening prompts. */
function isFree(graph: ClueGraphCase, clue: ClueGraphClue): boolean {
  return reachReason(graph, clue, () => false) !== null;
}

/** Whether a gate opens on `held` by its `after` and `use` alone, never a line of questioning. */
function opensWithoutLine(gate: ClueGraphGate, held: Set<string>): boolean {
  const { after = [], use, line } = gate;
  if (!after.every((earlier) => held.has(earlier))) return false;
  if (!use) return !line;
  return "any" in use ? use.any.some((id) => held.has(id)) : use.all.every((id) => held.has(id));
}

/**
 * The gated clues of `character` that open on their own clues alone: what
 * they say first, or are asked, shown back to them or waited out, with no
 * line of questioning and nothing from anyone or anywhere else.
 */
function selfOpened(graph: ClueGraphCase, character: string): string[] {
  const mine = Object.keys(graph.clues).filter((id) => {
    const clue = graph.clues[id];
    return clue.kind !== "evidence" && clue.source.character === character;
  });
  const held = new Set<string>();
  const opened: string[] = [];
  const reached = (clue: ClueGraphClue) =>
    clue.kind !== "evidence" && clue.reached.by === "gated"
      ? opensWithoutLine(clue.reached.gate, held)
      : reachReason(graph, clue, (other) => held.has(other)) !== null;
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of mine) {
      const clue = graph.clues[id];
      if (held.has(id) || !reached(clue)) continue;
      if (clue.kind !== "evidence" && clue.reached.by === "gated") opened.push(id);
      held.add(id);
      grew = true;
    }
  }
  return opened;
}

/** Statements some reached clue takes back. */
function takenBack(graph: ClueGraphCase, reached: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const [id, clue] of Object.entries(graph.clues))
    if (reached.has(id) && clue.kind === "statement") clue.takes_back?.forEach((target) => out.add(target));
  return out;
}

/**
 * False statements by one character that clear another, on a culprit route
 * without the confession: the route can draw on the statement, or on what
 * takes it back.
 */
export function falseAlibis(graph: ClueGraphCase, routes: CulpritRoute[]): string[] {
  const near = new Set(
    routes
      .filter((route) => !route.confession && route.turns !== null)
      .flatMap((route) => [...relevantClues(graph, { all: route.clues })]),
  );
  return Object.keys(graph.clues).filter((id) => {
    const clue = graph.clues[id];
    if (clue.kind !== "statement" || clue.truth) return false;
    const speaker = clue.source.character;
    const clearsAnother = Object.values(graph.conclusions).some(
      (conclusion) =>
        conclusion.clears !== undefined &&
        conclusion.clears !== speaker &&
        ruleLeaves(graph, conclusion.rule).has(id),
    );
    const retractions = Object.keys(graph.clues).filter((other) => {
      const by = graph.clues[other];
      return by.kind === "statement" && by.takes_back?.includes(id);
    });
    return clearsAnother && [id, ...retractions].some((step) => near.has(step));
  });
}

/** What each size count measures on a case. */
export function measureCase(graph: ClueGraphCase, routes = culpritRoutes(graph)): Record<SizeCount, number> {
  const clues = Object.values(graph.clues);
  const people = Object.values(graph.characters);
  const fitting = routes.filter((route) => route.turns !== null);
  const plain = fitting.filter((route) => !route.confession);
  const suspects = Object.keys(graph.characters).filter((id) => graph.characters[id].role === "suspect");
  const clearedOn = (suspect: string, route: CulpritRoute) =>
    Object.values(graph.conclusions).some(
      (conclusion) =>
        conclusion.clears === suspect && ruleMet(graph, conclusion.rule, (id) => route.clues.includes(id)),
    );
  return {
    time_budget: graph.metadata.time_budget,
    locations: Object.keys(graph.locations).length,
    suspects: suspects.length,
    witnesses: people.filter((person) => person.role === "witness").length,
    clues: clues.length,
    gated_clues: clues.filter((clue) => clue.kind !== "evidence" && clue.reached.by === "gated").length,
    false_statements: clues.filter((clue) => clue.kind === "statement" && !clue.truth).length,
    hidden_spots: Object.values(graph.locations).flatMap((place) => place.spots.filter((spot) => spot.revealed_by))
      .length,
    shortest_route: plain.length === 0 ? 0 : Math.min(...plain.map((route) => route.clues.length)),
    culprit_routes: fitting.length,
    false_alibis: falseAlibis(graph, routes).length,
    cleared_on_every_route:
      plain.length === 0
        ? 0
        : suspects.filter((suspect) => plain.every((route) => clearedOn(suspect, route))).length,
  };
}

const COUNT_WORDS: Record<SizeCount, string> = {
  time_budget: "turns",
  locations: "locations",
  suspects: "suspects",
  witnesses: "witnesses",
  clues: "clues",
  gated_clues: "gated clues",
  false_statements: "false statements",
  hidden_spots: "hidden spots",
  shortest_route: "clues on its shortest culprit route without the confession",
  culprit_routes: "routes to the culprit within the turn budget",
  false_alibis: "false alibis for someone else on a culprit route",
  cleared_on_every_route: "suspects cleared on every culprit route but the confession",
};

function bounds({ min, max }: CountRange): string {
  if (max === undefined) return `at least ${min}`;
  return max === min ? `exactly ${min}` : `${min} to ${max}`;
}

function checkSize(graph: ClueGraphCase, routes: CulpritRoute[], report: Report) {
  const { size, size_overrides: overrides = {} } = graph.metadata;
  if (size === undefined) return;
  const [conclusion] = culpritOf(graph);
  const where: Record<SizeCount, IssuePath> = {
    time_budget: ["metadata", "time_budget"],
    locations: ["locations"],
    suspects: ["characters"],
    witnesses: ["characters"],
    clues: ["clues"],
    gated_clues: ["clues"],
    false_statements: ["clues"],
    hidden_spots: ["locations"],
    shortest_route: ["conclusions", conclusion, "rule"],
    culprit_routes: ["conclusions", conclusion, "rule"],
    false_alibis: ["clues"],
    cleared_on_every_route: ["conclusions", conclusion, "rule"],
  };
  const measured = measureCase(graph, routes);
  const wanted = sizeBounds(size, overrides);
  for (const name of SIZE_COUNTS) {
    const range = wanted[name];
    const value = measured[name];
    if (value >= range.min && (range.max === undefined || value <= range.max)) continue;
    const source = overrides[name] ? `metadata.size_overrides.${name}` : `a ${size} case`;
    report(where[name], `Has ${value} ${COUNT_WORDS[name]}; ${source} needs ${bounds(range)}`);
  }
}

function checkRoutes(graph: ClueGraphCase, routes: CulpritRoute[], report: Report) {
  const [conclusion] = culpritOf(graph);
  const fitting = routes.filter((route) => route.turns !== null);
  const at = ["conclusions", conclusion, "rule"];
  if (culpritTerms(graph).cut)
    report(at, `Conclusion "${conclusion}" has more than ${MAX_ROUTES} routes to the culprit, too many to check`);
  // No route at all is the turn-budget check's to report.
  if (fitting.length === 0) return;
  if (fitting.length < 2)
    report(at, `Conclusion "${conclusion}" has one route to the culprit within the turn budget; it needs two`);
  if (fitting.every((route) => route.confession))
    report(at, `Conclusion "${conclusion}" has no route within the turn budget without the confession`);
}

function checkClearings(graph: ClueGraphCase, reached: Set<string>, report: Report) {
  const gone = takenBack(graph, reached);
  for (const [id, character] of Object.entries(graph.characters)) {
    if (character.role !== "suspect") continue;
    const clearings = Object.values(graph.conclusions).filter((conclusion) => conclusion.clears === id);
    const met = clearings.filter((conclusion) => ruleMet(graph, conclusion.rule, (clue) => reached.has(clue)));
    if (met.length === 0) continue;
    const lasting = met.some((conclusion) =>
      ruleMet(graph, conclusion.rule, (clue) => reached.has(clue) && !gone.has(clue)),
    );
    if (!lasting)
      report(["characters", id], `Suspect "${id}" is cleared only on statements later taken back`);
  }
}

function checkClues(graph: ClueGraphCase, report: Report) {
  const named = dependedOn(graph);
  const entries = Object.entries(graph.clues);
  const free = entries.filter(([, clue]) => isFree(graph, clue)).length;
  if (free > entries.length * MAX_FREE_SHARE)
    report(["clues"], `${free} of ${entries.length} clues are free from the opening; at most four in five may be`);
  for (const [id, clue] of entries) {
    if (!clue.colour && !named.has(id))
      report(["clues", id], `Clue "${id}" supports, opens and prompts nothing, and is not marked colour`);
    if (clue.colour && named.has(id))
      report(["clues", id, "colour"], `Clue "${id}" is marked colour, but something depends on it`);
  }
}

function checkCharacters(graph: ClueGraphCase, report: Report) {
  for (const id of Object.keys(graph.characters)) {
    const first = Object.values(graph.clues).filter(
      (clue) => clue.kind !== "evidence" && clue.source.character === id && clue.reached.by === "first_meeting",
    ).length;
    if (first > FIRST_WORDS_PER_LINE)
      report(
        ["characters", id],
        `Character "${id}" has ${first} first words; a greeting carries ${FIRST_WORDS_PER_LINE}`,
      );
    for (const clue of selfOpened(graph, id))
      report(["clues", clue, "reached", "gate"], `Clue "${clue}" opens on "${id}"'s own statements alone`);
  }
}

/** The checks for generated stories, after the graph checks. */
export function checkStory(graph: ClueGraphCase, reached: Set<string>, report: Report) {
  const routes = culpritRoutes(graph);
  checkClearings(graph, reached, report);
  checkRoutes(graph, routes, report);
  checkClues(graph, report);
  checkCharacters(graph, report);
  checkSize(graph, routes, report);
}
