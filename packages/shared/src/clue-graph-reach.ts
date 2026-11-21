import {
  OPENING_PROMPT,
  type ClueGraphCase,
  type ClueGraphClue,
  type ClueGraphGate,
  type ClueGraphRule,
} from "./clue-graph-schema.ts";

/** What a reach test asks of the clues held so far. */
export type Holds = (id: string) => boolean;

/** The spot an evidence clue sits in, or undefined for a location's plain search. */
function hiddenBy(
  graph: ClueGraphCase,
  location: string,
  spot: string | undefined,
): string | undefined {
  if (spot === undefined) return undefined;
  return graph.locations[location]?.spots.find((entry) => entry.name === spot)
    ?.revealed_by;
}

/** Why a gate opens on what is held, without a bluff, or null while it stays shut. */
export function gateOpens(gate: ClueGraphGate, holds: Holds): string | null {
  if (!(gate.after ?? []).every(holds)) return null;
  if (gate.use && "any" in gate.use) {
    const shown = gate.use.any.filter(holds);
    if (shown.length > 0) return `show ${shown.join(" or ")}`;
  }
  if (gate.use && "all" in gate.use && gate.use.all.every(holds))
    return `show ${gate.use.all.join(" and ")}`;
  const hint = gate.line?.hinted_by;
  if (hint !== undefined && holds(hint))
    return `line of questioning (hinted by ${hint})`;
  if (!gate.use && !gate.line)
    return `asked once ${(gate.after ?? []).join(" and ")} are out`;
  return null;
}

/**
 * Why a clue can be reached on what is held, or null if not yet. Presence is
 * not part of it: a character clue still needs a conversation, and evidence a
 * search, which the route search in `clue-graph-route.ts` adds.
 */
export function reachReason(
  graph: ClueGraphCase,
  clue: ClueGraphClue,
  holds: Holds,
): string | null {
  if (clue.kind === "evidence") {
    const { location, spot } = clue.source;
    const pointer = hiddenBy(graph, location, spot);
    if (pointer !== undefined && !holds(pointer)) return null;
    return spot ? `search ${spot}` : "plain search";
  }
  const { reached } = clue;
  switch (reached.by) {
    case "first_meeting":
      return "said on first meeting";
    case "seen":
      if (reached.subject !== undefined) return `seen when ${reached.subject} comes up`;
      return reached.with !== undefined && holds(reached.with)
        ? `seen with ${reached.with}`
        : null;
    case "asked": {
      const prompts = reached.prompted_by.filter(
        (prompt) => prompt === OPENING_PROMPT || holds(prompt),
      );
      return prompts.length > 0
        ? `ask about ${reached.about} (prompted by ${prompts.join(", ")})`
        : null;
    }
    case "gated":
      return gateOpens(reached.gate, holds);
  }
}

/** One reached clue and why, in the order the fixpoint reached it. */
export interface ReachedClue {
  id: string;
  by: string;
}

/**
 * Starting from the opening alone, adds every clue whose way of being reached
 * is already held, sweeping the clues in file order until nothing more is
 * added. A bluff never counts.
 */
export function reachClues(graph: ClueGraphCase): ReachedClue[] {
  const held = new Set<string>();
  const order: ReachedClue[] = [];
  const holds: Holds = (id) => held.has(id);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [id, clue] of Object.entries(graph.clues)) {
      if (held.has(id)) continue;
      const by = reachReason(graph, clue, holds);
      if (by === null) continue;
      held.add(id);
      order.push({ id, by });
      grew = true;
    }
  }
  return order;
}

/** Whether a conclusion's rule holds over the clues `holds` admits. */
export function ruleMet(
  graph: ClueGraphCase,
  rule: ClueGraphRule,
  holds: Holds,
): boolean {
  if (typeof rule === "string") {
    const conclusion = graph.conclusions[rule];
    return conclusion ? ruleMet(graph, conclusion.rule, holds) : holds(rule);
  }
  if ("all" in rule) return rule.all.every((part) => ruleMet(graph, part, holds));
  return rule.any.some((part) => ruleMet(graph, part, holds));
}
