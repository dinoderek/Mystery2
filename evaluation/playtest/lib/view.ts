// What the investigator is shown each turn: what a player of the web game can
// see, and nothing more.
//
// The status line (place, people here, turns left) and the notebook's
// sections, built with the web app's own notebook helpers (a clue-graph case
// adds its leads, and marks a clue taken back or noticed), then the story so
// far. The blueprint never appears here — only what the game's API hands the
// browser in its session state and narration.

import { ACCUSATIONS } from "../../../packages/game-engine/src/accusations.ts";
import type { GameState } from "../../../packages/shared/src/mystery-api-contracts.ts";
import {
  buildPeopleView,
  buildPlacesView,
  clueMark,
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
  return character ? character.first_name : String(id);
}

function modeLine(state: NotebookState): string {
  switch (state.mode) {
    case "talk":
      return `Talking with ${nameOfCharacter(state, state.current_talk_character)}`;
    case "accuse":
      // Out of turns there is no way back.
      return state.time_remaining > 0
        ? "Making your accusation (`back` returns to exploring, free)"
        : "Making your accusation (no way back: the turns are spent)";
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
  const leads = state.leads ?? [];

  const lines = [
    `CASE: ${title}`,
    "",
    "== STATUS ==",
    `Mode: ${modeLine(normalized)}`,
    `Location: ${here?.name ?? normalized.location}`,
    `People here: ${here && here.people.length > 0 ? here.people.join(", ") : "nobody"}`,
    `Turns left: ${normalized.time_remaining}`,
    `Accusations left: ${state.accusations_left} of ${ACCUSATIONS}`,
    "",
    "== NOTEBOOK: STORY ==",
    state.story ?? "",
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
    ...(leads.length === 0
      ? []
      : [
        "== NOTEBOOK: WHAT TO DO NEXT ==",
        ...leads.map((lead) => `- ${lead.text}${lead.new ? " [NEW]" : ""}`),
        "",
      ]),
    "== NOTEBOOK: CLUES ==",
    ...(clueBuckets.length === 0
      ? ["(none yet)"]
      : clueBuckets.flatMap((bucket) =>
        bucket.groups.flatMap((group) => [
          `${bucket.label} — ${group.label}:`,
          ...group.clues.map((clue) => {
            const mark = clueMark(clue);
            return `- ${clue.text}${mark ? ` (${mark})` : ""}`;
          }),
        ])
      )),
    "",
    "== STORY SO FAR ==",
    ...transcript.map(renderEntry),
  ];

  return lines.filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n");
}
