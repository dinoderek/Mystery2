// What the narrator is given for a clue-graph talk line or search: the derived
// state, and nothing the player has not earned. Pure: the turn and the prompt
// builder compute it from the same history, so they cannot disagree.

import { spotMatchScore } from "../search-target.ts";
import type { ClueGraphCase } from "../../../shared/src/clue-graph-schema.ts";
import { holds, visibleSpots, type ClueGraphPlay } from "./play.ts";
import { talkState, type ClueGraphTalkState } from "./talk-state.ts";

export interface GraphTalkContext {
  character: { id: string; name: string; sex: "male" | "female"; personality: string };
  location_name: string;
  /** True when the investigator has just turned to them and said nothing yet. */
  greeting: boolean;
  state: ClueGraphTalkState;
}

/**
 * The talk context for one line, or for the greeting when `greeting` is set. A
 * greeting carries only what a greeting can hold: first words, the story so
 * far and what to keep back. Nothing is asked yet, so nothing can open.
 */
export function buildGraphTalkContext(
  graph: ClueGraphCase,
  play: ClueGraphPlay,
  characterId: string,
  greeting: boolean,
): GraphTalkContext {
  const person = graph.characters[characterId];
  const state = talkState(graph, play, characterId);
  return {
    character: { id: characterId, name: person.name, sex: person.sex, personality: person.personality },
    location_name: graph.locations[person.location].name,
    greeting,
    state: greeting ? { ...state, answers_if_asked: [], gates: [], shows_when: [] } : state,
  };
}

/** A clue a search can find, and where: a spot, or null for the room itself. */
export interface SearchCandidate {
  spot: string | null;
  clue: { id: string; text: string };
}

/**
 * What a search can find. `known`: the engine resolved the spot (or the room,
 * for a plain search) and what it gives. `judge`: the words name no spot, so
 * the narrator decides which of the visible candidates, if any, they mean.
 */
export type SearchOutcome =
  | { kind: "known"; spot: string | null; finds: SearchCandidate["clue"] | null }
  | { kind: "judge"; candidates: SearchCandidate[] };

/** The spot of this location a query names best, hidden ones included, or null. */
export function namedSpot(graph: ClueGraphCase, location: string, query: string): string | null {
  const place = graph.locations[location];
  let best: { name: string; score: number } | null = null;
  for (const spot of place.spots) {
    const score = spotMatchScore(query, spot.name, place.name);
    if (score !== null && (best === null || score > best.score)) best = { name: spot.name, score };
  }
  return best?.name ?? null;
}

function unheldAt(graph: ClueGraphCase, play: ClueGraphPlay, location: string, spot: string | null) {
  const held = holds(play);
  const id = Object.keys(graph.clues).find((clueId) => {
    const clue = graph.clues[clueId];
    return clue.kind === "evidence" && clue.source.location === location && (clue.source.spot ?? null) === spot;
  });
  return id === undefined || held(id) ? null : { id, text: graph.clues[id].text };
}

export function searchOutcome(
  graph: ClueGraphCase,
  play: ClueGraphPlay,
  query: string | null,
): SearchOutcome {
  const location = play.at;
  const visible = visibleSpots(graph, play, location);
  const named = query === null ? null : namedSpot(graph, location, query);
  if (query === null || named !== null) {
    // A hidden spot named before its pointer is held finds nothing.
    const open = named === null || visible.includes(named);
    return { kind: "known", spot: named, finds: open ? unheldAt(graph, play, location, named) : null };
  }
  const candidates = [null, ...visible].flatMap((spot) => {
    const clue = unheldAt(graph, play, location, spot);
    return clue ? [{ spot, clue }] : [];
  });
  return { kind: "judge", candidates };
}

export interface GraphSearchContext {
  location_name: string;
  location_description: string;
  search_query: string | null;
  /** The only spots the narrator may mention. */
  visible_spots: string[];
  outcome: SearchOutcome;
}

export function buildGraphSearchContext(
  graph: ClueGraphCase,
  play: ClueGraphPlay,
  query: string | null,
): GraphSearchContext {
  const place = graph.locations[play.at];
  return {
    location_name: place.name,
    location_description: place.description,
    search_query: query,
    visible_spots: visibleSpots(graph, play, play.at),
    outcome: searchOutcome(graph, play, query),
  };
}
