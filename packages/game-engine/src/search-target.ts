// Whether a targeted search names a hidden spot. A hidden sub-location is never
// shown to the search narrator, so the narrator cannot judge a match against
// it: the engine does, from the words alone. Specificity, not possession: a
// player who works out where to look finds the clue there, whatever they hold.

// Words that say where or how to look rather than what at.
const IGNORED_WORDS = new Set([
  "around", "back", "behind", "beside", "below", "beneath", "bottom", "check",
  "find", "from", "front", "inside", "into", "look", "near", "next", "onto",
  "over", "search", "side", "some", "that", "them", "there", "this", "under",
  "underneath", "with", "your",
]);

function stem(word: string): string {
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(sh|ch|x|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** The words that say what something is: four letters or more, stemmed. */
export function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((word) => word.length >= 4 && !IGNORED_WORDS.has(word))
      .map(stem),
  );
}

/**
 * True when the query names at least half the spot's own words (rounded up).
 * Words of the location's name do not count, so searching the place itself
 * never names a spot in it.
 */
export function searchNamesSpot(query: string, spotName: string, locationName: string): boolean {
  const placeWords = contentWords(locationName);
  const spotWords = [...contentWords(spotName)].filter((word) => !placeWords.has(word));
  if (spotWords.length === 0) return false;
  const queryWords = contentWords(query);
  const hits = spotWords.filter((word) => queryWords.has(word)).length;
  return hits >= Math.ceil(spotWords.length / 2);
}
