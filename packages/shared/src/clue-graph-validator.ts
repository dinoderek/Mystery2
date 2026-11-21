import { z } from "zod";
import { has, reachClues, ruleMet } from "./clue-graph-reach.ts";
import { cheapestRoute } from "./clue-graph-route.ts";
import {
  ClueGraphCaseSchema,
  OPENING_PROMPT,
  type ClueGraphCase,
  type ClueGraphClue,
  type ClueGraphRule,
} from "./clue-graph-schema.ts";

/**
 * Validates a clue graph case: its shape, its references, then the graph
 * checks of `docs/clue-graph.md`, each naming the clue, conclusion, suspect or
 * spot at fault. Throws a ZodError listing every issue.
 */

type IssuePath = (string | number)[];
type Report = (path: IssuePath, message: string) => void;

class References {
  private readonly graph: ClueGraphCase;
  private readonly report: Report;
  ok = true;

  constructor(graph: ClueGraphCase, report: Report) {
    this.graph = graph;
    this.report = report;
  }

  fail(path: IssuePath, message: string) {
    this.ok = false;
    this.report(path, message);
  }

  location(path: IssuePath, value: string) {
    if (!has(this.graph.locations, value))
      this.fail(path, `Reference "${value}" must name a location`);
  }

  character(path: IssuePath, value: string) {
    if (!has(this.graph.characters, value))
      this.fail(path, `Reference "${value}" must name a character`);
  }

  /** A clue, optionally of one kind and from one character, never `self`. */
  clue(
    path: IssuePath,
    value: string,
    want: { self: string; kind?: ClueGraphClue["kind"]; from?: string; false?: true },
  ) {
    const target = has(this.graph.clues, value) ? this.graph.clues[value] : undefined;
    const needs = [
      want.false ? "false" : "",
      want.kind ?? "clue",
      want.from ? `from "${want.from}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const fits =
      target !== undefined &&
      value !== want.self &&
      (!want.kind || target.kind === want.kind) &&
      (!want.from || ("character" in target.source && target.source.character === want.from)) &&
      (!want.false || (target.kind === "statement" && !target.truth));
    if (!fits) this.fail(path, `Reference "${value}" must name another ${needs}`);
  }

  rule(path: IssuePath, rule: ClueGraphRule) {
    if (typeof rule === "string") {
      if (!has(this.graph.clues, rule) && !has(this.graph.conclusions, rule))
        this.fail(path, `Reference "${rule}" must name a clue or conclusion`);
      return;
    }
    const parts = "all" in rule ? rule.all : rule.any;
    const field = "all" in rule ? "all" : "any";
    parts.forEach((part, index) => this.rule([...path, field, index], part));
  }
}

function checkClueReferences(
  refs: References,
  id: string,
  clue: ClueGraphClue,
  graph: ClueGraphCase,
) {
  const path = ["clues", id];
  if (clue.kind === "evidence") {
    const { location, spot } = clue.source;
    refs.location([...path, "source", "location"], location);
    const known = has(graph.locations, location);
    if (known && spot !== undefined && !graph.locations[location].spots.some((entry) => entry.name === spot))
      refs.fail([...path, "source", "spot"], `Spot "${spot}" must be one of "${location}"'s spots`);
    return;
  }
  const from = clue.source.character;
  refs.character([...path, "source", "character"], from);
  const { reached } = clue;
  const at = [...path, "reached"];
  if (reached.by === "seen" && reached.with !== undefined)
    refs.clue([...at, "with"], reached.with, { self: id, kind: "statement", from });
  if (reached.by === "asked")
    reached.prompted_by.forEach((prompt, index) => {
      if (prompt !== OPENING_PROMPT)
        refs.clue([...at, "prompted_by", index], prompt, { self: id });
    });
  if (reached.by === "gated") {
    const { gate } = reached;
    // A self-reference in `after` is reported as a cycle, with the others.
    (gate.after ?? []).forEach((earlier, index) => {
      if (earlier !== id) refs.clue([...at, "gate", "after", index], earlier, { self: id, from });
    });
    const use = gate.use ? ("any" in gate.use ? gate.use.any : gate.use.all) : [];
    const field = gate.use && "any" in gate.use ? "any" : "all";
    use.forEach((shown, index) =>
      refs.clue([...at, "gate", "use", field, index], shown, { self: id }),
    );
    if (gate.line?.hinted_by !== undefined)
      refs.clue([...at, "gate", "line", "hinted_by"], gate.line.hinted_by, {
        self: id,
        kind: "tell",
        from,
      });
  }
  if (clue.kind === "statement")
    (clue.takes_back ?? []).forEach((target, index) =>
      refs.clue([...path, "takes_back", index], target, {
        self: id,
        kind: "statement",
        from,
        false: true,
      }),
    );
}

function checkReferences(graph: ClueGraphCase, report: Report): boolean {
  const refs = new References(graph, report);
  refs.location(["opening", "location"], graph.opening.location);
  for (const [id, character] of Object.entries(graph.characters))
    refs.location(["characters", id, "location"], character.location);
  for (const [id, location] of Object.entries(graph.locations)) {
    const names = new Set<string>();
    location.spots.forEach((spot, index) => {
      if (names.has(spot.name))
        refs.fail(["locations", id, "spots", index, "name"], `Spot "${spot.name}" is listed twice`);
      names.add(spot.name);
      if (spot.revealed_by !== undefined)
        refs.clue(["locations", id, "spots", index, "revealed_by"], spot.revealed_by, {
          self: "",
        });
    });
  }
  for (const [id, clue] of Object.entries(graph.clues))
    checkClueReferences(refs, id, clue, graph);
  for (const [id, conclusion] of Object.entries(graph.conclusions)) {
    if (has(graph.clues, id))
      refs.fail(["conclusions", id], `Conclusion "${id}" shares its ID with a clue`);
    refs.rule(["conclusions", id, "rule"], conclusion.rule);
    const named = conclusion.clears ?? conclusion.culprit;
    if (named !== undefined) refs.character(["conclusions", id], named);
  }
  return refs.ok && checkRoles(graph, report);
}

function checkRoles(graph: ClueGraphCase, report: Report): boolean {
  let ok = true;
  const culprits = Object.keys(graph.characters).filter(
    (id) => graph.characters[id].role === "culprit",
  );
  if (culprits.length !== 1) {
    ok = false;
    report(["characters"], `Exactly one character is the culprit, not ${culprits.length}`);
  }
  const naming = Object.keys(graph.conclusions).filter(
    (id) => graph.conclusions[id].culprit !== undefined,
  );
  if (naming.length !== 1) {
    ok = false;
    report(["conclusions"], `Exactly one conclusion names the culprit, not ${naming.length}`);
  }
  for (const [id, conclusion] of Object.entries(graph.conclusions)) {
    if (conclusion.culprit !== undefined && conclusion.culprit !== culprits[0]) {
      ok = false;
      report(["conclusions", id, "culprit"], `Conclusion "${id}" must name the culprit`);
    }
    const cleared =
      conclusion.clears !== undefined && has(graph.characters, conclusion.clears)
        ? graph.characters[conclusion.clears]
        : undefined;
    if (cleared && cleared.role !== "suspect") {
      ok = false;
      report(["conclusions", id, "clears"], `Conclusion "${id}" must clear a suspect`);
    }
  }
  return ok && checkConclusionCycles(graph, report);
}

function directParts(rule: ClueGraphRule): string[] {
  if (typeof rule === "string") return [rule];
  return ("all" in rule ? rule.all : rule.any).flatMap(directParts);
}

/** A ring of links back to `start`, as the path round it, or null. */
function findCycle(start: string, links: (id: string) => string[]): string[] | null {
  const visited = new Set<string>();
  const walk = (id: string, trail: string[]): string[] | null => {
    for (const next of links(id)) {
      if (next === start) return [...trail, next];
      if (visited.has(next)) continue;
      visited.add(next);
      const ring = walk(next, [...trail, next]);
      if (ring) return ring;
    }
    return null;
  };
  return walk(start, [start]);
}

function checkConclusionCycles(graph: ClueGraphCase, report: Report): boolean {
  let ok = true;
  for (const id of Object.keys(graph.conclusions)) {
    const ring = findCycle(id, (node) =>
      has(graph.conclusions, node) ? directParts(graph.conclusions[node].rule) : [],
    );
    if (ring) {
      ok = false;
      report(["conclusions", id, "rule"], `Conclusion "${id}" rests on itself: ${ring.join(" → ")}`);
    }
  }
  return ok;
}

function after(clue: ClueGraphClue): string[] {
  return clue.kind !== "evidence" && clue.reached.by === "gated" ? (clue.reached.gate.after ?? []) : [];
}

function checkShape(graph: ClueGraphCase, report: Report) {
  const spots = new Map<string, string[]>();
  for (const [id, clue] of Object.entries(graph.clues)) {
    if (clue.kind === "evidence") {
      const place = JSON.stringify([clue.source.location, clue.source.spot ?? null]);
      spots.set(place, [...(spots.get(place) ?? []), id]);
      continue;
    }
    const ring = findCycle(id, (node) => after(graph.clues[node]));
    if (ring)
      report(["clues", id, "reached", "gate", "after"], `Clue "${id}" needs itself first: ${ring.join(" → ")}`);
    const { reached } = clue;
    if (reached.by === "asked" && reached.prompted_by.length === 0)
      report(["clues", id, "reached", "prompted_by"], `Clue "${id}" is asked, but nothing prompts the question`);
    if (reached.by === "gated" && reached.gate.line && reached.gate.line.hinted_by === undefined)
      report(["clues", id, "reached", "gate", "line"], `Clue "${id}" has a worded gate with no tell that hints at it`);
  }
  for (const [place, ids] of spots) {
    if (ids.length < 2) continue;
    const [location, spot] = JSON.parse(place) as [string, string | null];
    const where = spot === null ? `The plain search at "${location}"` : `Spot "${spot}" at "${location}"`;
    report(["locations", location], `${where} holds more than one clue: ${ids.join(", ")}`);
  }
}

/** A statement taken back must be reachable without the clue that takes it back. */
function checkRetractionOrder(graph: ClueGraphCase, reached: Set<string>, report: Report) {
  for (const [id, clue] of Object.entries(graph.clues)) {
    if (clue.kind !== "statement" || !clue.takes_back || !reached.has(id)) continue;
    const before = new Set(reachClues(graph, id).map((entry) => entry.id));
    for (const target of clue.takes_back)
      if (reached.has(target) && !before.has(target))
        report(["clues", id, "takes_back"], `Clue "${id}" takes back "${target}", which is only reached after it`);
  }
}

function checkGraph(graph: ClueGraphCase, report: Report) {
  checkShape(graph, report);
  const reached = new Set(reachClues(graph).map((entry) => entry.id));
  const holds = (id: string) => reached.has(id);
  for (const [id, clue] of Object.entries(graph.clues)) {
    if (!reached.has(id)) report(["clues", id], `Clue "${id}" is never reached from the opening`);
    if (clue.kind !== "statement" || clue.truth) continue;
    const backed = Object.entries(graph.clues).some(
      ([other, by]) => reached.has(other) && by.kind === "statement" && by.takes_back?.includes(id),
    );
    if (!backed)
      report(["clues", id], `False statement "${id}" has no reachable clue that takes it back`);
  }
  checkRetractionOrder(graph, reached, report);
  for (const [id, conclusion] of Object.entries(graph.conclusions))
    if (!ruleMet(graph, conclusion.rule, holds))
      report(["conclusions", id], `Conclusion "${id}" cannot be reached`);
  for (const [id, character] of Object.entries(graph.characters)) {
    const cleared = Object.values(graph.conclusions).some((conclusion) => conclusion.clears === id);
    if (character.role === "suspect" && !cleared)
      report(["characters", id], `Suspect "${id}" has no conclusion that clears them`);
  }
  const [culprit, conclusion] = Object.entries(graph.conclusions).find(
    ([, value]) => value.culprit !== undefined,
  )!;
  if (ruleMet(graph, conclusion.rule, holds) && cheapestRoute(graph, conclusion.rule) === null)
    report(
      ["metadata", "time_budget"],
      `Conclusion "${culprit}" has no route within ${graph.metadata.time_budget} turns without a bluff`,
    );
}

/** Shape, references and graph checks; returns the typed case or throws ZodError. */
export function validateClueGraph(value: unknown): ClueGraphCase {
  const graph = ClueGraphCaseSchema.parse(value);
  const issues: z.ZodIssue[] = [];
  const report: Report = (path, message) =>
    issues.push({ code: z.ZodIssueCode.custom, path, message });
  if (checkReferences(graph, report)) checkGraph(graph, report);
  if (issues.length > 0) throw new z.ZodError(issues);
  return graph;
}

