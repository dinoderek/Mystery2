/**
 * Builds a hand-written search case on a blueprint: which clues the player
 * already holds, where they stand, and the one search typed. The history is
 * synthesised from the blueprint's own text, so the case states only the
 * situation that matters and cannot disagree with its blueprint.
 */

import fs from "node:fs";
import path from "node:path";

import type { Expect, HistoryEntry, TurnCase } from "./case.ts";

interface Clue {
  id: string;
  text: string;
}

interface Place {
  id: string;
  name: string;
  description: string;
  clues: Clue[];
  sub_locations?: Array<{ clues: Clue[] }>;
}

interface Character {
  id: string;
  first_name: string;
  location_id: string;
  clues?: Clue[];
}

interface Base {
  id: string;
  narrative: { premise: string };
  world: { starting_location_id: string; locations: Place[]; characters: Character[] };
}

export interface SearchSpec {
  id: string;
  group: string;
  /** Repo-relative blueprint path. */
  blueprint: string;
  /** Where the player stands. */
  location: string;
  /** What they type after `search`. */
  query: string;
  /** Clues already found, in the order found, wherever they sit. */
  found?: string[];
  expect: Expect;
}

const TIME_REMAINING = 8;

function readBase(blueprint: string): Base {
  return JSON.parse(fs.readFileSync(path.resolve(blueprint), "utf8")) as Base;
}

function clueHome(base: Base, clueId: string): { place: Place; clue: Clue; speaker?: Character } {
  for (const place of base.world.locations) {
    const clue = [...place.clues, ...(place.sub_locations ?? []).flatMap((s) => s.clues)].find((c) => c.id === clueId);
    if (clue) return { place, clue };
  }
  for (const speaker of base.world.characters) {
    const clue = speaker.clues?.find((c) => c.id === clueId);
    if (clue) return { place: base.world.locations.find((l) => l.id === speaker.location_id) as Place, clue, speaker };
  }
  throw new Error(`${base.id} has no clue ${clueId}`);
}

function moveTo(place: Place): HistoryEntry {
  return {
    event_type: "move",
    actor: "system",
    narration: place.description,
    payload: { location_id: place.id, location_name: place.name, destination: place.id },
  };
}

/** The events a player who found `found` would have left behind, ending on arrival at `location`. */
function historyFor(base: Base, location: Place, found: string[]) {
  const history: HistoryEntry[] = [{ event_type: "start", actor: "system", narration: base.narrative.premise, payload: {} }];
  const revealedHere: string[] = [];
  let at = base.world.locations.find((l) => l.id === base.world.starting_location_id) as Place;
  for (const [index, id] of found.entries()) {
    const { place, clue, speaker } = clueHome(base, id);
    if (place.id !== at.id) history.push(moveTo(place));
    at = place;
    const idsSoFar = found.slice(0, index + 1).filter((f) => clueHome(base, f).place.id === place.id);
    if (speaker) {
      const who = { character_id: speaker.id, character_name: speaker.first_name, location_id: place.id };
      history.push({ event_type: "talk", actor: "system", narration: `You step closer to ${speaker.first_name}.`, payload: who });
      history.push({
        event_type: "ask",
        actor: "system",
        narration: `"${clue.text}"`,
        payload: { ...who, player_input: "What can you tell me?", revealed_clue_ids: [id] },
      });
      history.push({ event_type: "end_talk", actor: "system", narration: `${speaker.first_name} waves goodbye.`, payload: who });
    } else {
      history.push({
        event_type: "search",
        actor: "system",
        narration: clue.text,
        payload: { location_id: place.id, location_name: place.name, revealed_clue_id: id, revealed_clue_ids: idsSoFar },
      });
    }
    if (place.id === location.id && !speaker) revealedHere.push(id);
  }
  if (at.id !== location.id) history.push(moveTo(location));
  return { history, revealedHere };
}

export function searchCase(spec: SearchSpec): TurnCase {
  const base = readBase(spec.blueprint);
  const location = base.world.locations.find((l) => l.id === spec.location);
  if (!location) throw new Error(`${spec.id}: ${base.id} has no location ${spec.location}`);
  const found = spec.found ?? [];
  const { history, revealedHere } = historyFor(base, location, found);
  return {
    id: spec.id,
    group: spec.group,
    blueprint: { path: spec.blueprint },
    given: {
      mode: "explore",
      location_id: location.id,
      time_remaining: TIME_REMAINING,
      discovered_clues: found,
      revealed_clue_ids: revealedHere,
      history,
    },
    action: { type: "search", search_query: spec.query },
    expect: spec.expect,
  };
}
