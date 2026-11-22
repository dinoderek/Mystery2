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

/**
 * The spot of this location a query names best, or null. A hidden spot not yet
 * visible wins only when it fits strictly better than every visible one, as
 * V2's `namedHiddenSpot` decides: "the shelf" between a visible top shelf and a
 * hidden bottom one is about the one in view.
 */
export function namedSpot(graph: ClueGraphCase, play: ClueGraphPlay, query: string): string | null {
  const place = graph.locations[play.at];
  const visible = new Set(visibleSpots(graph, play, play.at));
  let best: { name: string; score: number; visible: boolean } | null = null;
  for (const spot of place.spots) {
    const score = spotMatchScore(query, spot.name, place.name);
    if (score === null) continue;
    const shown = visible.has(spot.name);
    const better = best === null || score > best.score || (score === best.score && shown && !best.visible);
    if (better) best = { name: spot.name, score, visible: shown };
  }
  return best?.name ?? null;
}

function unheldAt(graph: ClueGraphCase, play: ClueGraphPlay, location: string, spot: string | null) {
  const held = holds(play);
  const id = Object.keys(graph.clues).find((clueId) => {
    const clue = graph.clues[clueId];
    return clue.kind === "evidence" && clue.source.location === location && (clue.source.spot ?? null) === spot;
  });
  return id === undefined || held(id) ? null : { id, text: graph.clues[id].fact };
}

/** What a search can find, as the narrator is told it. */
export function searchOutcome(
  graph: ClueGraphCase,
  play: ClueGraphPlay,
  query: string | null,
): SearchOutcome {
  return resolveGraphSearchWords(graph, play, query).outcome;
}

/**
 * The search the words make: what the narrator is told, and the spot the event
 * records when the outcome is known (null for the room itself). A hidden spot
 * named before its pointer is held is recorded, and finds nothing; the
 * narrator is told only that the search finds nothing, never the spot's name.
 */
export function resolveGraphSearchWords(
  graph: ClueGraphCase,
  play: ClueGraphPlay,
  query: string | null,
): { outcome: SearchOutcome; spot: string | null } {
  const location = play.at;
  const visible = visibleSpots(graph, play, location);
  const named = query === null ? null : namedSpot(graph, play, query);
  if (named !== null && !visible.includes(named))
    return { outcome: { kind: "known", spot: null, finds: null }, spot: named };
  if (query === null || named !== null)
    return { outcome: { kind: "known", spot: named, finds: unheldAt(graph, play, location, named) }, spot: named };
  const candidates = [null, ...visible].flatMap((spot) => {
    const clue = unheldAt(graph, play, location, spot);
    return clue ? [{ spot, clue }] : [];
  });
  return { outcome: { kind: "judge", candidates }, spot: null };
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
    location_description: place.facts.join(" "),
    search_query: query,
    visible_spots: visibleSpots(graph, play, play.at),
    outcome: searchOutcome(graph, play, query),
  };
}
