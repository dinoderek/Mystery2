// The game as the player's notebook reads it: the blueprint's public reference
// data (premise, places, people) joined with where the game stands now.

import type { GameState } from "../../shared/src/mystery-api-contracts.ts";
import type { PlayableCase } from "../../shared/src/playable-case.ts";

export type GameStanding = Pick<
  GameState,
  "discovered_clues" | "leads" | "time_remaining" | "accusations_left" | "location" | "mode" | "current_talk_character"
>;

/** What the notebook reads of a case. */
export type StateWorld = Pick<PlayableCase, "narrative" | "world">;

export function buildGameState(blueprint: StateWorld, standing: GameStanding): GameState {
  return {
    mystery_summary: blueprint.narrative.starting_knowledge.mystery_summary,
    premise: blueprint.narrative.premise,
    // A clue-graph case writes no one-line summary of a place or a person.
    locations: blueprint.world.locations.map((l) => ({ id: l.id, name: l.name, summary: null })),
    characters: blueprint.world.characters.map((c) => ({
      id: c.id,
      first_name: c.first_name,
      // A clue-graph character goes by one name.
      last_name: "",
      location_id: c.location_id,
      sex: c.sex,
      summary: null,
    })),
    ...standing,
  };
}
