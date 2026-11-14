// What the investigator is shown each turn: what a player of the web game can
// see, and nothing more.
//
// The status line (place, people here, turns left) and the notebook's four
// sections, built with the web app's own notebook helpers, then the story so
// far. The blueprint never appears here — only what the game's API hands the
// browser in its session state and narration.

import type { GameState } from "../../../packages/shared/src/mystery-api-contracts.ts";
import {
  buildPeopleView,
  buildPlacesView,
  groupCluesByOrigin,
} from "../../../web/src/lib/domain/notebook.ts";

/** The game state the web store keeps, which the notebook helpers read. */
export type NotebookState = NonNullable<Parameters<typeof buildPlacesView>[0]>;

/** One line of what the player has read so far. */
export type TranscriptEntry =
  | { kind: "input"; text: string; plan?: string }
  | { kind: "narration"; speaker: string; text: string }
  | { kind: "feedback"; text: string }
  | { kind: "error"; text: string };

/** The API's game state in the shape the web store keeps it. */
export function normalizeState(state: GameState): NotebookState {
  // The API names a character's place by id; the store also keeps its name, and
  // keeps the history, which the notebook helpers never read.
  return {
    ...state,
    characters: state.characters.map((character) => ({
      ...character,
      location_name: (character as { location_name?: string }).location_name || character.location_id,
    })),
    discovered_clues: state.discovered_clues ?? [],
  } as unknown as NotebookState;
}

function nameOfCharacter(state: NotebookState, id: string | null): string {
  const character = state.characters.find((entry) => entry.id === id);
  return character ? `${character.first_name} ${character.last_name}`.trim() : String(id);
}

function modeLine(state: NotebookState): string {
  switch (state.mode) {
    case "talk":
      return `Talking with ${nameOfCharacter(state, state.current_talk_character)}`;
    case "accuse":
      return "Making your accusation";
    case "ended":
      return "The case is over";
    default:
      return "Exploring";
  }
}

/** One transcript entry as the player reads it. */
export function renderEntry(entry: TranscriptEntry): string {
  switch (entry.kind) {
    case "input":
      return `> ${entry.text}`;
    case "narration":
      return `${entry.speaker}: ${entry.text}`;
    case "feedback":
      return `[game] ${entry.text}`;
    case "error":
      return `[error] ${entry.text}`;
  }
}

/**
 * The full text the investigator reads before choosing its next input.
 * `title` is the case title from the public case list.
 */
export function buildView({
  title,
  state,
  transcript,
}: {
  title: string;
  state: GameState;
  transcript: readonly TranscriptEntry[];
}): string {
  const normalized = normalizeState(state);
  const places = buildPlacesView(normalized);
  const people = buildPeopleView(normalized);
  const here = places.find((place) => place.isCurrent);
  const clueBuckets = groupCluesByOrigin(normalized.discovered_clues);

  const lines = [
    `CASE: ${title}`,
    "",
    "== STATUS ==",
    `Mode: ${modeLine(normalized)}`,
    `Location: ${here?.name ?? normalized.location}`,
    `People here: ${here && here.people.length > 0 ? here.people.join(", ") : "nobody"}`,
    `Turns left: ${normalized.time_remaining}`,
    "",
    "== NOTEBOOK: STORY ==",
    normalized.premise ?? "",
    normalized.mystery_summary ? `\n${normalized.mystery_summary}` : "",
    "",
    "== NOTEBOOK: PLACES ==",
    ...places.map((place) =>
      `- ${place.name}${place.isCurrent ? " (you are here)" : ""}` +
      `${place.people.length > 0 ? ` — ${place.people.join(", ")}` : ""}` +
      `${place.summary ? `: ${place.summary}` : ""}`
    ),
    "",
    "== NOTEBOOK: PEOPLE ==",
    ...people.map((person) =>
      `- ${person.displayName}${person.locationLabel ? ` (at ${person.locationLabel})` : ""}` +
      `${person.summary ? `: ${person.summary}` : ""}`
    ),
    "",
    "== NOTEBOOK: CLUES ==",
    ...(clueBuckets.length === 0
      ? ["(none yet)"]
      : clueBuckets.flatMap((bucket) =>
        bucket.groups.flatMap((group) => [
          `${bucket.label} — ${group.label}:`,
          ...group.clues.map((clue) => `- ${clue.text}`),
        ])
      )),
    "",
    "== STORY SO FAR ==",
    ...transcript.map(renderEntry),
  ];

  return lines.filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n");
}
