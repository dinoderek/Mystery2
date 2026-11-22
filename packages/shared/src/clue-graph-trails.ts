import { reachClues } from "./clue-graph-reach.ts";
import { prerequisites } from "./clue-graph-route.ts";
import type { ClueGraphCase, ClueGraphClue, ClueGraphRule } from "./clue-graph-schema.ts";

/**
 * A case's graph printed as trails, in Markdown: for each conclusion, the
 * chains of clues that reach it from the opening, each step with how it is
 * reached. It reads the validated case and the validator's own reach order
 * (`reachClues`) and prints facts as authored; it adds no rule of its own.
 */

/** The most routes a conclusion prints; one with more says so. */
const MAX_ROUTES = 12;

/** The leaf clues of each way a rule can hold, through nested conclusions; the first `MAX_ROUTES`. */
function routesOf(graph: ClueGraphCase, rule: ClueGraphRule): string[][] {
  if (typeof rule === "string")
    return Object.hasOwn(graph.conclusions, rule) ? routesOf(graph, graph.conclusions[rule].rule) : [[rule]];
  if ("any" in rule) return rule.any.flatMap((part) => routesOf(graph, part)).slice(0, MAX_ROUTES);
  return rule.all.reduce<string[][]>(
    (routes, part) =>
      routes.flatMap((route) => routesOf(graph, part).map((more) => [...new Set([...route, ...more])])).slice(0, MAX_ROUTES),
    [[]],
  );
}

function ruleWords(rule: ClueGraphRule): string {
  if (typeof rule === "string") return rule;
  if ("all" in rule) return `all of (${rule.all.map(ruleWords).join(", ")})`;
  return `any of (${rule.any.map(ruleWords).join(", ")})`;
}

function sourceWords(graph: ClueGraphCase, clue: ClueGraphClue): string {
  if (clue.kind === "evidence") {
    const place = graph.locations[clue.source.location].name;
    return clue.source.spot ? `${clue.source.spot}, ${place}` : place;
  }
  const person = graph.characters[clue.source.character];
  return `${person.name}, ${graph.locations[person.location].name}`;
}

/** The clue's step: what it is, how it is reached, and what it takes back or is taken back by. */
function stepLines(graph: ClueGraphCase, id: string, by: string, takenBackBy: Map<string, string[]>): string[] {
  const clue = graph.clues[id];
  const label = clue.kind === "statement" ? `statement, ${clue.truth ? "true" : "false"}` : clue.kind;
  const lines = [`- \`${id}\` (${label}; ${sourceWords(graph, clue)}): ${clue.fact}`, `  - reached: ${by}`];
  if (clue.kind !== "evidence" && clue.reached.by === "gated") {
    const { line, physical } = clue.reached.gate;
    if (line) lines.push(`  - line of questioning: ${line.text}`);
    if (physical) lines.push("  - physical: it cannot be bluffed");
  }
  if (clue.kind === "statement" && !clue.truth && clue.why) lines.push(`  - why it is said: ${clue.why}`);
  if (clue.kind === "statement" && clue.takes_back)
    lines.push(`  - takes back: ${clue.takes_back.map((target) => `\`${target}\``).join(", ")}`);
  const backers = takenBackBy.get(id);
  if (backers) lines.push(`  - taken back by: ${backers.map((backer) => `\`${backer}\``).join(", ")}`);
  return lines;
}

/**
 * Every clue a route's leaves need, in the order the validator reaches them:
 * all the ways in that were held before a clue, not only the one it used.
 */
function trailOf(graph: ClueGraphCase, leaves: string[], order: Map<string, number>): string[] {
  const chain = new Set<string>();
  const visit = (id: string) => {
    if (chain.has(id) || !order.has(id)) return;
    chain.add(id);
    // What opened a clue was held before it; the rest of its names are other ways in.
    prerequisites(graph, id)
      .filter((need) => (order.get(need) ?? Infinity) < order.get(id)!)
      .forEach(visit);
  };
  leaves.forEach(visit);
  return [...chain].sort((a, b) => order.get(a)! - order.get(b)!);
}

function conclusionKind(graph: ClueGraphCase, id: string): string {
  const conclusion = graph.conclusions[id];
  if (conclusion.culprit !== undefined) return `names the culprit, ${graph.characters[conclusion.culprit].name}`;
  if (conclusion.clears !== undefined) return `clears ${graph.characters[conclusion.clears].name}`;
  if (conclusion.resolves !== undefined) return `resolves: ${conclusion.resolves}`;
  return "a stepping stone";
}

/** The case's graph as Markdown trails. The case must be valid (`validateClueGraph`). */
export function clueGraphTrails(graph: ClueGraphCase): string {
  const reached = reachClues(graph);
  const order = new Map(reached.map((entry, index) => [entry.id, index]));
  const by = new Map(reached.map((entry) => [entry.id, entry.by]));
  const takenBackBy = new Map<string, string[]>();
  for (const [id, clue] of Object.entries(graph.clues))
    if (clue.kind === "statement")
      for (const target of clue.takes_back ?? []) takenBackBy.set(target, [...(takenBackBy.get(target) ?? []), id]);

  const out = [
    `# ${graph.metadata.title}: trails`,
    "",
    `Opening at ${graph.locations[graph.opening.location].name} (reading age ${graph.metadata.target_age}, ${graph.metadata.time_budget} turns): ${graph.opening.facts.join(" ")}`,
  ];
  for (const [id, conclusion] of Object.entries(graph.conclusions)) {
    const routes = routesOf(graph, conclusion.rule);
    out.push(
      "",
      `## \`${id}\`: ${conclusionKind(graph, id)}`,
      "",
      conclusion.text,
      "",
      `Rule: ${ruleWords(conclusion.rule)}`,
    );
    if (routes.length === MAX_ROUTES) out.push("", `Only the first ${MAX_ROUTES} routes are printed.`);
    routes.forEach((leaves, index) => {
      out.push("", `### Trail ${index + 1} of ${routes.length}`, "");
      for (const step of trailOf(graph, leaves, order)) out.push(...stepLines(graph, step, by.get(step)!, takenBackBy));
    });
  }
  return `${out.join("\n")}\n`;
}
