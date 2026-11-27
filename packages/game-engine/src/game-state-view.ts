// The game as the player's notebook reads it: the blueprint's places and
// people, the opening as it was narrated, and where the game stands now.

import type { GameState } from "../../shared/src/mystery-api-contracts.ts";
import type { PlayableCase } from "../../shared/src/playable-case.ts";
import type { NarrationEventRecord } from "./narration.ts";

export type GameStanding = Pick<
  GameState,
  "discovered_clues" | "leads" | "time_remaining" | "accusations_left" | "location" | "mode" | "current_talk_character"
>;

/** What the notebook reads of a case. */
export type StateWorld = Pick<PlayableCase, "world">;

/**
 * `story` is the notebook's Story: the opening narration the game's `start`
 * event saved, at the age it was written for. The case's own text never
 * reaches it.
 */
export function buildGameState(blueprint: StateWorld, story: string | null, standing: GameStanding): GameState {
  return {
    story,
    // A clue-graph case writes no one-line summary of a place or a person.
    locations: blueprint.world.locations.map((l) => ({ id: l.id, name: l.name, summary: null })),
    characters: blueprint.world.characters.map((c) => ({
      id: c.id,
      first_name: c.first_name,
      location_id: c.location_id,
      sex: c.sex,
      summary: null,
    })),
    ...standing,
  };
}

/**
 * The Story a saved game's notebook shows: its `start` event's first part,
 * the narrated opening (the second is the engine's notebook tip). Null when the
 * game has no start event.
 */
export function storyOf(events: readonly NarrationEventRecord[]): string | null {
  return events.find((event) => event.event_type === "start")?.narration_parts[0]?.text ?? null;
}
