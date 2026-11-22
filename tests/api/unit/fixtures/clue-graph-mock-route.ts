// The lines a player types to win a clue-graph case on the mock narrator: the
// fewest turns, by the game's costs (`docs/clue-graph.md`), that hold every
// clue of one route to the culprit, then an accusation that names the culprit
// and cites one of them. It plans from the case alone and never bluffs, so a
// win shows the case can be won as written, not that a line was tuned to it.

import type { ClueGraphCase } from "@my2/shared";
import { gateOpens, reachReason, type Holds } from "../../../../packages/shared/src/clue-graph-reach.ts";
import { relevantClues } from "../../../../packages/shared/src/clue-graph-route.ts";

type Action =
  | { kind: "move"; location: string }
  | { kind: "search"; id: string; spot: string | undefined }
  | { kind: "talk"; character: string; gained: string[] };

interface State {
  at: string;
  held: Set<string>;
  actions: Action[];
}

const key = (state: Pick<State, "at" | "held">) => `${state.at}|${[...state.held].sort().join(",")}`;

/** What a conversation with `character` gives on what is held: every clue of theirs it can reach, in the order reached. */
function conversation(graph: ClueGraphCase, relevant: Set<string>, character: string, held: Set<string>): string[] {
  const out = new Set(held);
  const gained: string[] = [];
  const holds: Holds = (id) => out.has(id);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [id, clue] of Object.entries(graph.clues)) {
      if (clue.kind === "evidence" || clue.source.character !== character) continue;
      if (!relevant.has(id) || out.has(id) || reachReason(graph, clue, holds) === null) continue;
      out.add(id);
      gained.push(id);
      grew = true;
    }
  }
  return gained;
}

function next(graph: ClueGraphCase, relevant: Set<string>, state: State): State[] {
  const states: State[] = [];
  const holds: Holds = (id) => state.held.has(id);
  for (const [id, clue] of Object.entries(graph.clues)) {
    if (clue.kind !== "evidence" || clue.source.location !== state.at) continue;
    if (!relevant.has(id) || state.held.has(id) || reachReason(graph, clue, holds) === null) continue;
    states.push({ at: state.at, held: new Set([...state.held, id]), actions: [...state.actions, { kind: "search", id, spot: clue.source.spot }] });
  }
  for (const [character, person] of Object.entries(graph.characters)) {
    if (person.location !== state.at) continue;
    const gained = conversation(graph, relevant, character, state.held);
    if (gained.length === 0) continue;
    states.push({ at: state.at, held: new Set([...state.held, ...gained]), actions: [...state.actions, { kind: "talk", character, gained }] });
  }
  for (const location of Object.keys(graph.locations))
    if (location !== state.at) states.push({ at: location, held: state.held, actions: [...state.actions, { kind: "move", location }] });
  return states;
}

/** The fewest actions, each a turn, that hold every clue in `route`; breadth first over where the player is and what they hold. */
export function plan(graph: ClueGraphCase, route: string[]): Action[] {
  const relevant = relevantClues(graph, { all: route });
  let frontier: State[] = [{ at: graph.opening.location, held: new Set(), actions: [] }];
  const seen = new Set(frontier.map(key));
  for (let turn = 0; turn < graph.metadata.time_budget; turn++) {
    const after: State[] = [];
    for (const state of frontier)
      for (const candidate of next(graph, relevant, state)) {
        if (route.every((id) => candidate.held.has(id))) return candidate.actions;
        if (seen.has(key(candidate))) continue;
        seen.add(key(candidate));
        after.push(candidate);
      }
    frontier = after;
  }
  throw new Error(`No plan holds ${route.join(", ")} within ${graph.metadata.time_budget} turns`);
}

/** The line that brings one clue out in a conversation, as the mock reads lines; none for what the greeting or another clue carries. */
function lineFor(graph: ClueGraphCase, id: string, held: Holds): string | null {
  const clue = graph.clues[id];
  if (clue.kind === "evidence") throw new Error(`${id} is found by searching`);
  const { reached } = clue;
  if (reached.by === "first_meeting") return null;
  if (reached.by === "seen") return reached.subject === undefined ? null : `Tell me about ${reached.subject}.`;
  if (reached.by === "asked") return `What about ${reached.about}?`;
  const { gate } = reached;
  const why = gateOpens(gate, held);
  if (why === null) throw new Error(`${id}'s gate is shut`);
  if (why.startsWith("show ")) return `Look at this: ${why.slice("show ".length)}.`;
  if (why.startsWith("line of questioning")) return `I want to ask about ${id}.`;
  return "Please tell me the truth.";
}

/** The lines that play `actions`, one turn each, with the free conversation lines between. */
export function linesFor(graph: ClueGraphCase, actions: Action[]): string[] {
  const lines: string[] = [];
  const held = new Set<string>();
  for (const action of actions) {
    if (action.kind === "move") lines.push(`go to ${graph.locations[action.location].name}`);
    if (action.kind === "search") {
      lines.push(action.spot === undefined ? "search" : `search ${action.spot}`);
      held.add(action.id);
    }
    if (action.kind === "talk") {
      lines.push(`talk to ${graph.characters[action.character].name}`);
      for (const id of action.gained) {
        const line = lineFor(graph, id, (clue) => held.has(clue));
        if (line !== null) lines.push(line);
        held.add(id);
      }
      lines.push("bye");
    }
  }
  return lines;
}
