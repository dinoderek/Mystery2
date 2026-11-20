// Builders for the hand-written talk cases: a short played history (clues
// found, a visit opened, earlier questions) in the shape the game stores, and
// the case around it. Not a case file itself; the folder's case files import it.

import type { HistoryEntry, TurnCase } from "../../../lib/case.ts";

/** The four truth-set bases the hand-written cases are played on. */
export const BASES = {
  lighthouse: "evaluation/truth/bases/lighthouse-lens/blueprint.json",
  snowFoxes: "evaluation/truth/bases/large-snow-foxes/blueprint.json",
  glitterwood: "evaluation/truth/bases/glitterwood-forest/blueprint.json",
  greenhouse: "evaluation/truth/bases/greenhouse-prizewinner/blueprint.json",
} as const;

export interface Place {
  id: string;
  name: string;
}

/** The player searched and found clues (`ids` are every clue found by this search). */
export function found(place: Place, ids: string[], narration: string): HistoryEntry {
  return {
    event_type: "search",
    narration,
    payload: {
      location_id: place.id,
      location_name: place.name,
      revealed_clue_ids: ids,
      revealed_clue_id: ids[ids.length - 1],
    },
  };
}

/** The player began talking with a character. */
export function met(place: Place, characterId: string, name: string, narration: string): HistoryEntry {
  return {
    event_type: "talk",
    narration,
    payload: { character_id: characterId, character_name: name, location_id: place.id },
  };
}

export interface AskedOutcome {
  /** Clues this answer gave the player, which the player then holds. */
  revealed?: string[];
  /** Clues the player used on the character, which can earn a part. */
  used?: string[];
  commitments?: string[];
}

/** An earlier question and answer in the same conversation. */
export function asked(
  place: Place,
  [characterId, name]: readonly [id: string, name: string],
  playerInput: string,
  narration: string,
  outcome: AskedOutcome = {},
): HistoryEntry {
  return {
    event_type: "ask",
    narration,
    payload: {
      player_input: playerInput,
      character_id: characterId,
      character_name: name,
      location_id: place.id,
      revealed_clue_ids: outcome.revealed ?? [],
      used_clue_ids: outcome.used ?? [],
      new_commitments: outcome.commitments ?? [],
    },
  };
}

type Talk = Pick<TurnCase, "id" | "group" | "expect" | "ungraded" | "judges"> & {
  /** What the player types on the turn under test. */
  say: string;
};

/** A turn in a conversation with `characterId`, who stands at `place`. */
export function talkCase(blueprintPath: string, place: Place, characterId: string, history: HistoryEntry[], { say, ...rest }: Talk): TurnCase {
  return {
    ...rest,
    blueprint: { path: blueprintPath },
    given: {
      mode: "talk",
      location_id: place.id,
      talk_character_id: characterId,
      time_remaining: 20,
      history,
    },
    action: { type: "ask", player_input: say },
  };
}
