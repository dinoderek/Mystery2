// Whether a targeted search names a hidden spot. A hidden sub-location is never
// shown to the search narrator, so the narrator cannot judge a match against
// it: the engine does, from the words alone. Specificity, not possession: a
// player who works out where to look finds the clue there, whatever they hold.

import { type GatedClue, isSpotHidden } from "./clue-discovery.ts";

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

// Words that join a thing to where it is: the thing comes before them.
const JOINING_WORDS = new Set(["at", "beside", "by", "for", "from", "in", "near", "of", "on", "with"]);

function contentWord(word: string): string | null {
  return word.length >= 4 && !IGNORED_WORDS.has(word) ? stem(word) : null;
}

function rawWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z]+/)
    .filter((word) => word.length > 0);
}

/** The words that say what something is, in order: four letters or more, stemmed. */
export function contentWords(text: string): string[] {
  const words = rawWords(text).map(contentWord).filter((word): word is string => word !== null);
  return [...new Set(words)];
}

/**
 * The thing a spot name names: its last content word before a joining word
 * ("the shelf by the door" is a shelf), else its last content word ("behind the
 * big woodpile" is a woodpile).
 */
function headWord(spotName: string, ignore: Set<string>): string | undefined {
  const words = rawWords(spotName);
  const own = (list: string[]) =>
    list.map(contentWord).filter((word): word is string => word !== null && !ignore.has(word));
  const join = words.findIndex((word) => JOINING_WORDS.has(word));
  return (join > 0 ? own(words.slice(0, join)).at(-1) : undefined) ?? own(words).at(-1);
}

/**
 * True when the query names the spot's head word (`headWord`) and at least half
 * its own words, rounded up. A shared adjective alone ("the dusty floor" for
 * "the dusty bookshelf") names nothing. Words of the location's name do not
 * count, so searching the place never names a spot in it.
 */
export function searchNamesSpot(query: string, spotName: string, locationName: string): boolean {
  const placeWords = new Set(contentWords(locationName));
  const spotWords = contentWords(spotName).filter((word) => !placeWords.has(word));
  const head = headWord(spotName, placeWords);
  if (head === undefined) return false;
  const queryWords = new Set(contentWords(query));
  const hits = spotWords.filter((word) => queryWords.has(word)).length;
  return queryWords.has(head) && hits >= Math.ceil(spotWords.length / 2);
}

interface Spot {
  id: string;
  name: string;
  clues: GatedClue[];
}

/**
 * The hidden spot (`isSpotHidden`) a targeted search names, if any. The one
 * place this is decided: the search context shows it, and the search turn
 * admits its clue, so every caller agrees.
 */
export function namedHiddenSpot<S extends Spot>(
  location: { name: string; sub_locations?: S[] },
  query: string | null | undefined,
  discovered: Set<string>,
): S | null {
  if (!query || query.trim().length === 0) return null;
  return (
    (location.sub_locations ?? []).find(
      (spot) => isSpotHidden(spot, discovered) && searchNamesSpot(query, spot.name, location.name),
    ) ?? null
  );
}
