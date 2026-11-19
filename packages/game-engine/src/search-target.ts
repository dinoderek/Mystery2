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

// Folds plurals and a final -e or -y, so "cookies" and "cookie", "berries" and
// "berry", "edges" and "edge" meet. Crude, and only ever compared with itself.
function stem(word: string): string {
  let base = word;
  if (/(sh|ch|x|ss)es$/.test(base)) base = base.slice(0, -2);
  else if (base.endsWith("s") && !base.endsWith("ss")) base = base.slice(0, -1);
  if (base.endsWith("ie")) return `${base.slice(0, -2)}i`;
  if (base.endsWith("y")) return `${base.slice(0, -1)}i`;
  if (base.endsWith("e")) return base.slice(0, -1);
  return base;
}

/** The words that say what something is, in order: four letters or more, stemmed. */
export function contentWords(text: string): string[] {
  const words = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 4 && !IGNORED_WORDS.has(word))
    .map(stem);
  return [...new Set(words)];
}

/**
 * True when the query names the spot's head word (its last own word, the thing
 * itself) and at least half its own words, rounded up. A shared adjective alone
 * ("the dusty floor" for "the dusty bookshelf") names nothing. Words of the
 * location's name do not count, so searching the place never names a spot in it.
 */
export function searchNamesSpot(query: string, spotName: string, locationName: string): boolean {
  const placeWords = new Set(contentWords(locationName));
  const spotWords = contentWords(spotName).filter((word) => !placeWords.has(word));
  const head = spotWords.at(-1);
  if (head === undefined) return false;
  const queryWords = new Set(contentWords(query));
  const hits = spotWords.filter((word) => queryWords.has(word)).length;
  return queryWords.has(head) && hits >= Math.ceil(spotWords.length / 2);
}
