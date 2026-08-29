// Shared helpers for mapping blueprint clue ids to their player-facing text.
// Used by the talk/search runtime (to tell the AI what the player knows) and by
// the game endpoints (to surface discovered clues to the in-game notebook).

export interface ClueRef {
  id: string;
  text: string;
}

// Minimal structural shape these helpers need from a blueprint. Both the
// runtime `BlueprintContext` and the Zod-parsed blueprint satisfy it.
export interface ClueWorld {
  world: {
    locations: Array<{
      clues: ClueRef[];
      sub_locations?: Array<{ clues: ClueRef[] }>;
    }>;
    characters: Array<{ clues: ClueRef[] }>;
  };
}

/** Build an id -> {id, text} map over every clue in the blueprint. */
export function buildBlueprintClueMap(blueprint: ClueWorld): Map<string, ClueRef> {
  const map = new Map<string, ClueRef>();
  for (const location of blueprint.world.locations) {
    for (const clue of location.clues) {
      map.set(clue.id, { id: clue.id, text: clue.text });
    }
    for (const subLoc of location.sub_locations ?? []) {
      for (const clue of subLoc.clues) {
        map.set(clue.id, { id: clue.id, text: clue.text });
      }
    }
  }
  for (const character of blueprint.world.characters) {
    for (const clue of character.clues) {
      map.set(clue.id, { id: clue.id, text: clue.text });
    }
  }
  return map;
}

/**
 * Resolve a set of clue ids to their {id, text} records, preserving input
 * order and dropping duplicates and ids absent from the blueprint.
 */
export function mapClueIdsToClues(
  blueprint: ClueWorld,
  ids: Iterable<string>,
): ClueRef[] {
  const map = buildBlueprintClueMap(blueprint);
  const seen = new Set<string>();
  const result: ClueRef[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const clue = map.get(id);
    if (clue) result.push(clue);
  }
  return result;
}
