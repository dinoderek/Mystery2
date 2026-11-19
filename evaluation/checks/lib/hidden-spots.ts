// A sub-location whose clues are all locked starts the game hidden: the engine
// tells no narrator it exists until something points there. Every narrator
// reads the location's own `description`, so a description that names the
// spot advertises it anyway. This finds descriptions that share a distinctive
// word with a hidden spot's name or id.
//
// A distinctive word has four letters or more and is not a place word that
// says only where a spot is ("behind", "under", "back"). Words are compared
// in the singular, so "snowshoes" matches "snowshoe_hooks".

/** The fields read below, all optional: a candidate blueprint need not be well formed. */
export interface HiddenSpotsBlueprint {
  world?: {
    locations?: Array<{
      id: string;
      description?: string;
      sub_locations?: Array<{
        id: string;
        name?: string;
        clues?: Array<{ requires?: { clue_ids?: string[] } | null }>;
      }>;
    }>;
  };
}

/** A location description that names a spot hidden at the start of the game. */
export interface NamedHiddenSpot {
  location_id: string;
  sub_location_id: string;
  words: string[];
}

const PLACE_WORDS = new Set([
  "above", "across", "around", "back", "behind", "below", "beneath", "beside",
  "between", "beyond", "bottom", "corner", "down", "front", "inside", "into",
  "near", "next", "outside", "over", "side", "spot", "there", "top", "under",
  "underneath", "with",
  "big", "little", "large", "small", "tiny", "tall", "long", "huge", "old",
  "the", "this", "that",
]);

function singular(word: string): string {
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function distinctiveWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return new Set(words.filter((word) => word.length >= 4 && !PLACE_WORDS.has(word)).map(singular));
}

function isHidden(spot: { clues?: Array<{ requires?: { clue_ids?: string[] } | null }> }): boolean {
  const clues = spot.clues ?? [];
  return clues.length > 0 && clues.every((clue) => (clue.requires?.clue_ids ?? []).length > 0);
}

export function findNamedHiddenSpots(blueprint: HiddenSpotsBlueprint | null | undefined): NamedHiddenSpot[] {
  const named: NamedHiddenSpot[] = [];
  for (const location of blueprint?.world?.locations ?? []) {
    const described = distinctiveWords(location.description ?? "");
    for (const spot of location.sub_locations ?? []) {
      if (!isHidden(spot)) continue;
      const spotWords = distinctiveWords(`${spot.name ?? ""} ${spot.id.replace(/[_-]+/g, " ")}`);
      const words = [...spotWords].filter((word) => described.has(word)).sort();
      if (words.length > 0) named.push({ location_id: location.id, sub_location_id: spot.id, words });
    }
  }
  return named;
}
