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

// Words that join a thing to where it is: the thing comes before them ("the
// bench under the clock" is a bench).
const JOINING_WORDS = new Set([
  "above", "at", "behind", "below", "beneath", "beside", "by", "for", "from",
  "in", "inside", "near", "of", "on", "over", "under", "underneath", "with",
]);

// Words that count a thing rather than name it: "the row of key hooks" is hooks.
const QUANTITY_WORDS = new Set(["bunch", "couple", "heap", "line", "lot", "pair", "pile", "row", "set", "stack"]);

// Short words that never say what a thing is.
const SHORT_WORDS = new Set([
  "all", "and", "any", "are", "big", "bit", "can", "did", "few", "for", "get",
  "had", "has", "her", "him", "his", "how", "its", "let", "may", "new", "not",
  "now", "off", "old", "one", "our", "out", "own", "put", "see", "the", "too",
  "top", "try", "two", "use", "was", "way", "who", "why", "you",
]);

// Quantity words say how much, not what: they never need naming.
const COUNTING_STEMS = new Set([...QUANTITY_WORDS].map(stem));

function contentWord(word: string): string | null {
  if (word.length < 3 || SHORT_WORDS.has(word) || IGNORED_WORDS.has(word)) return null;
  return stem(word);
}

function rawWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z]+/)
    .filter((word) => word.length > 0);
}

/** The words that say what something is, in order, stemmed. */
export function contentWords(text: string): string[] {
  const words = rawWords(text).map(contentWord).filter((word): word is string => word !== null);
  return [...new Set(words)];
}

/**
 * The thing a spot name names: its last content word before a joining word
 * ("the shelf by the door" is a shelf), else its last content word ("behind the
 * big woodpile" is a woodpile). Before "of", a quantity word gives way to what
 * it counts ("the stack of lobster pots" is pots).
 */
function headWord(spotName: string, ignore: Set<string>): string | undefined {
  const words = rawWords(spotName);
  const own = (list: string[]) =>
    list.map(contentWord).filter((word): word is string => word !== null && !ignore.has(word));
  const join = words.findIndex((word) => JOINING_WORDS.has(word));
  if (join <= 0) return own(words).at(-1);
  const before = own(words.slice(0, join)).at(-1);
  const counted = words[join] === "of" && before !== undefined && QUANTITY_WORDS.has(words[join - 1] ?? "");
  return (counted ? own(words.slice(join + 1)).at(-1) : before) ?? own(words).at(-1);
}

/**
 * True when the query names the spot's head word (`headWord`) and at least half
 * its own words, rounded up. A shared adjective alone ("the dusty floor" for
 * "the dusty bookshelf") names nothing. Words of the location's name do not
 * count, so searching the place never names a spot in it.
 */
export function searchNamesSpot(query: string, spotName: string, locationName: string): boolean {
  const placeWords = new Set(contentWords(locationName));
  const spotWords = contentWords(spotName).filter((word) => !placeWords.has(word) && !COUNTING_STEMS.has(word));
  const head = headWord(spotName, placeWords);
  if (head === undefined) return false;
  const queryWords = new Set(contentWords(query));
  const hits = spotWords.filter((word) => queryWords.has(word)).length;
  return queryWords.has(head) && hits >= Math.ceil(spotWords.length / 2);
}

// Words that link others and say nothing about which spot is meant.
const LINKING_WORDS = new Set(["a", "an", "and", "at", "by", "in", "of", "on", "the", "to"]);

/**
 * How closely a query fits a spot it names: the spot's words it shares,
 * position words such as "front" or "bottom" included, since those tell sibling
 * spots apart. Null when the query does not name the spot (`searchNamesSpot`).
 */
export function spotMatchScore(query: string, spotName: string, locationName: string): number | null {
  if (!searchNamesSpot(query, spotName, locationName)) return null;
  const placeWords = new Set(contentWords(locationName));
  const words = (text: string) =>
    new Set(rawWords(text).filter((word) => !LINKING_WORDS.has(word)).map(stem).filter((word) => !placeWords.has(word)));
  const queryWords = words(query);
  return [...words(spotName)].filter((word) => queryWords.has(word)).length;
}

interface Spot {
  id: string;
  name: string;
  clues: GatedClue[];
}

/**
 * The hidden spot (`isSpotHidden`) a targeted search names, if any. The one
 * place this is decided: the search context shows it, and the search turn
 * admits its clue, so every caller agrees. A hidden spot wins only when it
 * fits the query better than every spot in view: "the left drawer" finds a
 * hidden left drawer beside a visible right one, while "the shelf" between a
 * visible top shelf and a hidden bottom one is about the one in view.
 */
export function namedHiddenSpot<S extends Spot>(
  location: { name: string; sub_locations?: S[] },
  query: string | null | undefined,
  discovered: Set<string>,
): S | null {
  if (!query || query.trim().length === 0) return null;
  let visibleBest = -1;
  let hidden: { spot: S; score: number } | null = null;
  for (const spot of location.sub_locations ?? []) {
    const score = spotMatchScore(query, spot.name, location.name);
    if (score === null) continue;
    if (!isSpotHidden(spot, discovered)) visibleBest = Math.max(visibleBest, score);
    else if (hidden === null || score > hidden.score) hidden = { spot, score };
  }
  return hidden !== null && hidden.score > visibleBest ? hidden.spot : null;
}
