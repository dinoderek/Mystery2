import { reachReason, ruleMet, type Holds } from "./clue-graph-reach.ts";
import type { ClueGraphCase, ClueGraphRule } from "./clue-graph-schema.ts";

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

class Router {
  private readonly graph: ClueGraphCase;
  private readonly rule: ClueGraphRule;
  private readonly bit = new Map<string, bigint>();
  private readonly byLocation = new Map<string, string[]>();
  private readonly byCharacter = new Map<string, string[]>();

  constructor(graph: ClueGraphCase, rule: ClueGraphRule) {
    this.graph = graph;
    this.rule = rule;
    for (const [index, [id, clue]] of Object.entries(graph.clues).entries()) {
      this.bit.set(id, 1n << BigInt(index));
      const [map, owner] =
        clue.kind === "evidence"
          ? [this.byLocation, clue.source.location]
          : [this.byCharacter, clue.source.character];
      map.set(owner, [...(map.get(owner) ?? []), id]);
    }
  }

  private holds(held: Held): Holds {
    return (id) => ((this.bit.get(id) ?? 0n) & held) !== 0n;
  }

  /** The rule holds over held clues not taken back. */
  done(held: Held): boolean {
    let back = 0n;
    for (const [id, clue] of Object.entries(this.graph.clues))
      if (clue.kind === "statement" && this.holds(held)(id))
        for (const target of clue.takes_back ?? []) back |= this.bit.get(target)!;
    return ruleMet(this.graph, this.rule, this.holds(held & ~back));
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

/**
 * Whether a state is no better than one already reached as soon: the same
 * place and nothing more held. Holding more never closes a way in.
 */
function covered(seen: Map<string, Held[]>, state: State): boolean {
  const here = seen.get(state.at) ?? [];
  if (here.some((held) => (held & state.held) === state.held)) return true;
  seen.set(state.at, [...here.filter((held) => (held & state.held) !== held), state.held]);
  return false;
}

/**
 * The fewest turns that support `rule` within the case's turn budget, never
 * relying on a bluff, or null when no route fits.
 */
export function cheapestRoute(graph: ClueGraphCase, rule: ClueGraphRule): number | null {
  const router = new Router(graph, rule);
  const start: State = { held: 0n, at: graph.opening.location };
  const seen = new Map<string, Held[]>();
  covered(seen, start);
  let frontier = [start];
  const budget = graph.metadata.time_budget;
  for (let turn = 1; turn <= budget && frontier.length > 0; turn++) {
    const next: State[] = [];
    for (const state of frontier) {
      const [states, done] = router.step(state, turn === budget);
      if (done) return turn;
      next.push(...states.filter((candidate) => !covered(seen, candidate)));
    }
    frontier = next;
  }
  return null;
}
