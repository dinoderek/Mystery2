// A sub-location whose clues are all locked starts the game hidden
// (`isSpotHidden`): the engine tells no narrator it exists until something
// points there. Every narrator reads the location's own `description`, so a
// description that names the spot advertises it anyway. This finds
// descriptions that share a word with a hidden spot's name, counting words as
// a targeted search does (`spotNameWords`), so "Snowshoes hang on hooks" names
// "the snowshoe hooks out back".

import { type GatedClue, isSpotHidden } from "../../../packages/game-engine/src/clue-discovery.ts";
import { contentWords, spotNameWords } from "../../../packages/game-engine/src/search-target.ts";

/** The fields read below. */
export interface HiddenSpotsBlueprint {
  world: {
    locations: Array<{
      id: string;
      name: string;
      description: string;
      sub_locations?: Array<{ id: string; name: string; clues: GatedClue[] }>;
    }>;
  };
}

/** A location description that names a spot hidden at the start of the game. */
export interface NamedHiddenSpot {
  location_id: string;
  sub_location_id: string;
  words: string[];
}

export function findNamedHiddenSpots(blueprint: HiddenSpotsBlueprint): NamedHiddenSpot[] {
  const named: NamedHiddenSpot[] = [];
  const nothingFound = new Set<string>();
  for (const location of blueprint.world.locations) {
    const described = new Set(contentWords(location.description));
    for (const spot of location.sub_locations ?? []) {
      if (!isSpotHidden(spot, nothingFound)) continue;
      const words = spotNameWords(spot.name, location.name).filter((word) => described.has(word)).sort();
      if (words.length > 0) named.push({ location_id: location.id, sub_location_id: spot.id, words });
    }
  }
  return named;
}
