// Builders for the clue-graph cases: a short play, written as the steps a
// player takes, folded by the engine into the history rows the game stores
// (`payload.clue_graph` carries each event), and the case around it. A step
// whose reports the engine would drop throws, so a case's history is always
// one the game could have recorded. Not a case file itself; the story folders'
// case files import it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ClueGraphCase } from "../../../../../packages/shared/src/clue-graph-schema.ts";
import { validateClueGraph } from "../../../../../packages/shared/src/clue-graph-validator.ts";
import {
  applyEvent,
  startPlay,
  type ClueGraphEvent,
  type ClueGraphPlay,
} from "../../../../../packages/game-engine/src/clue-graph/play.ts";
import type { Expect, HistoryEntry, TurnCase } from "../../../lib/case.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

/** A clue-graph case file, by its repo-relative path, validated as the game loads it. */
export function readGraph(file: string): ClueGraphCase {
  return validateClueGraph(JSON.parse(fs.readFileSync(path.join(REPO, file), "utf8")));
}

/** One thing the player did before the turn under test, with what the game showed. */
export type Step =
  | { move: string }
  /** `search` names a spot, or is null for a look around the room. */
  | { search: string | null; narration?: string }
  | { talk: string; narration: string }
  /** A line in the conversation open now, and what the narrator reported it earned. */
  | { say: string; reply: string; opened?: string[]; asked?: string[]; seen?: string[] };

export interface Played {
  graph: ClueGraphCase;
  play: ClueGraphPlay;
  history: HistoryEntry[];
}

function eventOf(step: Step, play: ClueGraphPlay): ClueGraphEvent {
  if ("move" in step) return { type: "move", location: step.move };
  if ("search" in step) return step.search === null ? { type: "search" } : { type: "search", spot: step.search };
  if ("talk" in step) return { type: "talk", character: step.talk };
  if (!play.talking) throw new Error(`"${step.say}" is said outside a conversation`);
  return { type: "line", character: play.talking, opened: step.opened ?? [], asked: step.asked ?? [], seen: step.seen ?? [] };
}

function rowOf(graph: ClueGraphCase, step: Step, event: ClueGraphEvent, before: ClueGraphPlay, revealed: string[]): HistoryEntry {
  const location = before.at;
  const place = { location_id: event.type === "move" ? event.location : location };
  if (event.type === "move") {
    return { event_type: "move", narration: `You head to ${graph.locations[event.location].name}.`, payload: { ...place, destination_id: event.location, clue_graph: event } };
  }
  if (event.type === "search") {
    const text = revealed.length > 0 ? graph.clues[revealed[0]].text : "You find nothing new.";
    return {
      event_type: "search",
      narration: ("narration" in step && step.narration) || text,
      payload: {
        ...place,
        location_name: graph.locations[location].name,
        search_query: event.spot ?? null,
        revealed_clue_id: revealed[0] ?? null,
        revealed_clue_ids: revealed,
        clue_graph: event,
      },
    };
  }
  const person = { character_id: event.character, character_name: graph.characters[event.character].name };
  if (event.type === "talk") {
    return { event_type: "talk", narration: (step as { narration: string }).narration, payload: { ...place, ...person, revealed_clue_ids: revealed, clue_graph: event } };
  }
  const line = step as Extract<Step, { say: string }>;
  return {
    event_type: "ask",
    narration: line.reply,
    payload: { ...place, ...person, player_input: line.say, revealed_clue_ids: revealed, input_understood: true, clue_graph: event },
  };
}

/** Plays `steps` from the opening, as the engine folds them. */
export function played(graph: ClueGraphCase, steps: Step[]): Played {
  let play = startPlay(graph);
  const history: HistoryEntry[] = [];
  for (const step of steps) {
    const event = eventOf(step, play);
    const outcome = applyEvent(graph, play, event);
    if (outcome.rejected.length > 0) {
      throw new Error(`the engine would drop ${outcome.rejected.join(", ")} from ${JSON.stringify(step)}`);
    }
    history.push(rowOf(graph, step, event, play, outcome.revealed));
    play = outcome.play;
  }
  return { graph, play, history: history.map((row, index) => ({ sequence: index + 2, actor: "system", ...row })) };
}

interface Labels {
  id: string;
  group: string;
  expect: Expect;
  ungraded?: boolean;
}

function given(file: string, { graph, play, history }: Played, mode: "explore" | "talk") {
  return {
    blueprint: { path: file },
    given: {
      mode,
      location_id: play.at,
      ...(mode === "talk" && play.talking ? { talk_character_id: play.talking } : {}),
      time_remaining: graph.metadata.time_budget - play.turns,
      discovered_clues: play.held,
      history,
    },
  };
}

/** A line said to the character the play is talking to. */
export function lineCase(file: string, steps: Step[], say: string, labels: Labels): TurnCase {
  const before = played(readGraph(file), steps);
  if (!before.play.talking) throw new Error(`${labels.id}: the play ends outside a conversation`);
  return { ...labels, ...given(file, before, "talk"), action: { type: "ask", player_input: say } };
}

/** A search where the play stands: `query` null is a look around the room. */
export function searchCase(file: string, steps: Step[], query: string | null, labels: Labels): TurnCase {
  const before = played(readGraph(file), steps);
  return { ...labels, ...given(file, before, "explore"), action: { type: "search", ...(query === null ? {} : { search_query: query }) } };
}
