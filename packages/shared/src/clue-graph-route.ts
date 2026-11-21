import { reachReason, ruleMet, type Holds } from "./clue-graph-reach.ts";
import { OPENING_PROMPT, type ClueGraphCase, type ClueGraphRule } from "./clue-graph-schema.ts";

/**
 * The cheapest route to a conclusion within the turn budget, without a bluff.
 * The cost model is the game's (`docs/clue-graph.md`): a move, a search and
 * starting a talk cost one turn each; lines while talking cost none. A talk
 * started on the budget's last turn gives only the greeting.
 */

/** Held clues as bits, in file order. */
type Held = bigint;

interface State {
  held: Held;
  at: string;
}

/** The clues that can open the way to `id`: what its way of being reached names. */
function prerequisites(graph: ClueGraphCase, id: string): string[] {
  const clue = graph.clues[id];
  if (clue.kind === "evidence") {
    const { location, spot } = clue.source;
    const pointer = graph.locations[location].spots.find((entry) => entry.name === spot)?.revealed_by;
    return pointer === undefined ? [] : [pointer];
  }
  const { reached } = clue;
  if (reached.by === "seen") return reached.with === undefined ? [] : [reached.with];
  if (reached.by === "asked") return reached.prompted_by;
  if (reached.by !== "gated") return [];
  const { after = [], use, line } = reached.gate;
  const shown = use ? ("any" in use ? use.any : use.all) : [];
  return [...after, ...shown, ...(line?.hinted_by === undefined ? [] : [line.hinted_by])];
}

/**
 * The clues a route to `rule` can need: its leaves, through conclusions, and
 * what each needs in turn. Searching or asking for anything else never helps,
 * so the route search leaves it out.
 */
function relevantClues(graph: ClueGraphCase, rule: ClueGraphRule): Set<string> {
  const out = new Set<string>();
  const visit = (part: ClueGraphRule) => {
    if (typeof part !== "string") return ("all" in part ? part.all : part.any).forEach(visit);
    if (Object.hasOwn(graph.conclusions, part)) return visit(graph.conclusions[part].rule);
    if (out.has(part) || !Object.hasOwn(graph.clues, part)) return;
    out.add(part);
    prerequisites(graph, part).forEach(visit);
  };
  visit(rule);
  return out;
}

/** The clues a way of being reached cannot do without, beyond the clue itself. */
function needed(graph: ClueGraphCase, id: string): string[] {
  const clue = graph.clues[id];
  if (clue.kind === "evidence") return prerequisites(graph, id);
  const { reached } = clue;
  if (reached.by === "seen") return prerequisites(graph, id);
  if (reached.by === "asked") {
    const prompts = reached.prompted_by.filter((prompt) => prompt !== OPENING_PROMPT);
    return prompts.length === 1 && prompts.length === reached.prompted_by.length ? prompts : [];
  }
  if (reached.by !== "gated") return [];
  const { after = [], use, line } = reached.gate;
  return [...after, ...(use && "all" in use && !line ? use.all : [])];
}

/** How many alternative mandatory sets the bound keeps before merging them. */
const MAX_ALTERNATIVES = 32;

function together(left: Set<string>, right: Set<string>): Set<string> {
  return new Set([...left, ...right]);
}

function shared(sets: Set<string>[]): Set<string> {
  return sets.reduce((left, right) => new Set([...left].filter((id) => right.has(id))));
}

/**
 * Sets of clues such that every route to `rule` holds all of one of them: an
 * any-of offers each branch's, an all-of joins one from each part. Past
 * MAX_ALTERNATIVES the sets are merged into what they share, which stays a
 * lower bound.
 */
function mandatorySets(graph: ClueGraphCase, rule: ClueGraphRule): Set<string>[] {
  if (typeof rule !== "string") {
    const parts = ("all" in rule ? rule.all : rule.any).map((part) => mandatorySets(graph, part));
    if ("any" in rule) {
      const options = parts.flat();
      return options.length > MAX_ALTERNATIVES ? [shared(options)] : options;
    }
    return parts.reduce((left, right) =>
      left.length * right.length > MAX_ALTERNATIVES
        ? [together(shared(left), shared(right))]
        : left.flatMap((a) => right.map((b) => together(a, b))),
    );
  }
  if (Object.hasOwn(graph.conclusions, rule)) return mandatorySets(graph, graph.conclusions[rule].rule);
  const out = new Set<string>();
  const visit = (id: string) => {
    if (out.has(id) || !Object.hasOwn(graph.clues, id)) return;
    out.add(id);
    needed(graph, id).forEach(visit);
  };
  visit(rule);
  return [out];
}

class Router {
  private readonly graph: ClueGraphCase;
  private readonly rule: ClueGraphRule;
  private readonly bit = new Map<string, bigint>();
  private readonly byLocation = new Map<string, string[]>();
  private readonly byCharacter = new Map<string, string[]>();
  private readonly mandatory: string[][];

  constructor(graph: ClueGraphCase, rule: ClueGraphRule) {
    this.graph = graph;
    this.rule = rule;
    const relevant = relevantClues(graph, rule);
    this.mandatory = mandatorySets(graph, rule).map((set) => [...set]);
    for (const [index, [id, clue]] of Object.entries(graph.clues).entries()) {
      if (!relevant.has(id)) continue;
      this.bit.set(id, 1n << BigInt(index));
      const [map, owner] =
        clue.kind === "evidence"
          ? [this.byLocation, clue.source.location]
          : [this.byCharacter, clue.source.character];
      map.set(owner, [...(map.get(owner) ?? []), id]);
    }
  }

  /**
   * The fewest turns still needed from a state, for the cheapest mandatory
   * set: one search per evidence clue, one talk per character with a clue, and
   * one move per place among them other than here. Never more than the real cost.
   */
  atLeast(state: State): number {
    return Math.min(...this.mandatory.map((set) => this.toFinish(state, set)));
  }

  private toFinish(state: State, set: string[]): number {
    const places = new Set<string>();
    const speakers = new Set<string>();
    let searches = 0;
    for (const id of set) {
      if (this.holds(state.held)(id)) continue;
      const clue = this.graph.clues[id];
      if (clue.kind === "evidence") {
        searches++;
        places.add(clue.source.location);
      } else {
        speakers.add(clue.source.character);
        places.add(this.graph.characters[clue.source.character].location);
      }
    }
    places.delete(state.at);
    return searches + speakers.size + places.size;
  }

  private holds(held: Held): Holds {
    return (id) => ((this.bit.get(id) ?? 0n) & held) !== 0n;
  }

  /**
   * The rule holds over the clues held. A statement taken back still counts:
   * what a retraction does to a conclusion in play is the engine's, and
   * counting it keeps "holding more never closes a way in" true.
   */
  done(held: Held): boolean {
    return ruleMet(this.graph, this.rule, this.holds(held));
  }

  private reachable(id: string, held: Held): boolean {
    return reachReason(this.graph, this.graph.clues[id], this.holds(held)) !== null;
  }

  /** The clues held after each search here that finds one. */
  searches(state: State): Held[] {
    return (this.byLocation.get(state.at) ?? [])
      .filter((id) => !this.holds(state.held)(id) && this.reachable(id, state.held))
      .map((id) => state.held | this.bit.get(id)!);
  }

  /**
   * A conversation with one character: everything their clues give on what is
   * held, free, one line at a time. Returns the clues held after it and
   * whether the rule held after some line.
   */
  talk(character: string, held: Held, greetingOnly: boolean): [Held, boolean] {
    let out = held;
    const mine = this.byCharacter.get(character) ?? [];
    let grew = true;
    while (grew) {
      grew = false;
      for (const id of mine) {
        if (this.holds(out)(id) || !this.allowed(id, out, greetingOnly)) continue;
        out |= this.bit.get(id)!;
        grew = true;
        if (this.done(out)) return [out, true];
      }
    }
    return [out, false];
  }

  private allowed(id: string, held: Held, greetingOnly: boolean): boolean {
    const clue = this.graph.clues[id];
    if (clue.kind === "evidence") return false;
    const { reached } = clue;
    const greeting =
      reached.by === "first_meeting" || (reached.by === "seen" && reached.with !== undefined);
    return (greeting || !greetingOnly) && this.reachable(id, held);
  }

  /** Every state one turn on, and whether the rule holds in one of them. */
  step(state: State, lastTurn: boolean): [State[], boolean] {
    const next: State[] = [];
    for (const location of Object.keys(this.graph.locations))
      if (location !== state.at) next.push({ held: state.held, at: location });
    for (const held of this.searches(state)) {
      if (this.done(held)) return [next, true];
      next.push({ held, at: state.at });
    }
    for (const [character, value] of Object.entries(this.graph.characters)) {
      if (value.location !== state.at) continue;
      const [held, done] = this.talk(character, state.held, lastTurn);
      if (done) return [next, true];
      next.push({ held, at: state.at });
    }
    return [next, false];
  }
}

interface Visit {
  held: Held;
  turns: number;
}

/**
 * Whether a state is no better than one already reached here as soon, holding
 * at least as much. Holding more never closes a way in.
 */
function covered(seen: Map<string, Visit[]>, state: State, turns: number): boolean {
  const here = seen.get(state.at) ?? [];
  if (here.some((visit) => visit.turns <= turns && (visit.held & state.held) === state.held))
    return true;
  const kept = here.filter(
    (visit) => !(turns <= visit.turns && (state.held & visit.held) === visit.held),
  );
  seen.set(state.at, [...kept, { held: state.held, turns }]);
  return false;
}

/** Whether some route reaches the rule in at most `limit` turns, depth first. */
function routeWithin(router: Router, start: State, limit: number, budget: number): boolean {
  const seen = new Map<string, Visit[]>();
  const pending = [{ state: start, turns: 0 }];
  while (pending.length > 0) {
    const { state, turns } = pending.pop()!;
    if (turns === limit || covered(seen, state, turns)) continue;
    const [states, done] = router.step(state, turns + 1 === budget);
    if (done) return true;
    // Moves come first in `states`, so searches and talks are tried first.
    for (const next of states)
      if (turns + 1 + router.atLeast(next) <= limit) pending.push({ state: next, turns: turns + 1 });
  }
  return false;
}

/**
 * The fewest turns that support `rule` within the case's turn budget, never
 * relying on a bluff, or null when no route fits. Deepens one turn at a time,
 * so each search is bounded by the turns it may still spend.
 */
export function cheapestRoute(graph: ClueGraphCase, rule: ClueGraphRule): number | null {
  const router = new Router(graph, rule);
  const start: State = { held: 0n, at: graph.opening.location };
  const budget = graph.metadata.time_budget;
  for (let limit = router.atLeast(start); limit <= budget; limit++)
    if (routeWithin(router, start, limit, budget)) return limit;
  return null;
}
