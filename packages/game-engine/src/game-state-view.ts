// The game as the player's notebook reads it: the blueprint's public reference
// data (premise, places, people) joined with where the game stands now.

import type { BlueprintV2 } from "../../shared/src/blueprint-schema-v2.ts";
import type { GameState } from "../../shared/src/mystery-api-contracts.ts";

export type GameStanding = Pick<
  GameState,
  "discovered_clues" | "time_remaining" | "location" | "mode" | "current_talk_character"
>;

export function buildGameState(blueprint: BlueprintV2, standing: GameStanding): GameState {
  const startingKnowledge = blueprint.narrative.starting_knowledge;
  const locationSummaries = new Map(
    (startingKnowledge?.locations ?? []).map((l) => [l.location_id, l.summary]),
  );
  const characterSummaries = new Map(
    (startingKnowledge?.characters ?? []).map((c) => [c.character_id, c.summary]),
  );

  return {
    mystery_summary: startingKnowledge?.mystery_summary ?? null,
    premise: blueprint.narrative.premise,
    locations: blueprint.world.locations.map((l) => ({
      id: l.id,
      name: l.name,
      summary: locationSummaries.get(l.id) ?? null,
    })),
    characters: blueprint.world.characters.map((c) => ({
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      location_id: c.location_id,
      sex: c.sex,
      summary: characterSummaries.get(c.id) ?? null,
    })),
    ...standing,
  };
}
