/**
 * The Clues panel of a turn: what `clue_handling` is judged against
 * (`evaluation/truth/guide.md`, section 3). It holds the clues this turn
 * revealed, the clues its speaker or place could have given, and what the
 * player held before it, each with its blueprint text, its holder, its
 * `requires` and what it points to. Built from the stored trace and blueprint
 * alone; where they lack something, the panel says so rather than guess.
 */

import { playedEvents, readField, revealedClueIdsForEvent } from "../lib/game-events.ts";
import type { StoredGame } from "../lib/truth/schemas.ts";

type StoredEvent = StoredGame["events"][number];

export interface PanelClue {
  id: string;
  /** Null when the blueprint has no clue by that id; every other field is then empty. */
  text: string | null;
  /** Whose clue it is: a character's name, or a place's ("Grand Hall" or "Grand Hall, under the rug"). */
  holder: string | null;
  holderKind: "character" | "place" | null;
  /** The ids its `requires` names; empty when it is ungated. */
  requires: string[];
  /** Whether every one of `requires` was held before this turn. */
  requiresMet: boolean;
  /** Who or where it points to: its `about_character_id` and `hint_location_id`, named. */
  pointsTo: string[];
  /** Whether the player held it before this turn. */
  held: boolean;
  /** On a search, the next unrevealed, unlocked clue of the place: the one a search should give. */
  next: boolean;
}

export interface CluePanelView {
  revealed: PanelClue[];
  /** Whose clues this turn could reveal: the character spoken to, or the place searched or entered. */
  source: { kind: "character" | "place"; name: string } | null;
  candidates: PanelClue[];
  /** Why no candidates are listed, when the turn has no source or the trace does not name one the blueprint has. */
  noSource: string | null;
  /** What the player held before this turn, in the order they found it. */
  held: PanelClue[];
}

interface BlueprintClue {
  id: string;
  text: string | null;
  holder: string;
  holderKind: "character" | "place";
  requires: string[];
  aboutCharacterId: string | null;
  hintLocationId: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function characterName(character: Record<string, unknown>): string {
  return [text(character.first_name), text(character.last_name)].filter(Boolean).join(" ") || (text(character.name) ?? text(character.id) ?? "someone");
}

function cluesOf(holder: Record<string, unknown>, name: string, holderKind: BlueprintClue["holderKind"]): BlueprintClue[] {
  return records(holder.clues).flatMap((clue) => {
    const id = text(clue.id);
    if (!id) return [];
    const requires = record(clue.requires).clue_ids;
    return [
      {
        id,
        text: text(clue.text),
        holder: name,
        holderKind,
        requires: Array.isArray(requires) ? requires.filter((item): item is string => text(item) !== null) : [],
        aboutCharacterId: text(clue.about_character_id),
        hintLocationId: text(clue.hint_location_id),
      },
    ];
  });
}

/** A place's clues: its own, in order, then each sub-place's. */
function placeClues(location: Record<string, unknown>): BlueprintClue[] {
  const name = text(location.name) ?? text(location.id) ?? "a place";
  return [
    ...cluesOf(location, name, "place"),
    ...records(location.sub_locations).flatMap((sub) => cluesOf(sub, `${name}, ${text(sub.name) ?? text(sub.id) ?? "a sub-place"}`, "place")),
  ];
}

interface ClueBook {
  byId: Map<string, BlueprintClue>;
  locations: Record<string, unknown>[];
  characters: Record<string, unknown>[];
}

function clueBook(blueprint: unknown): ClueBook {
  const world = record(record(blueprint).world);
  const locations = records(world.locations);
  const characters = records(world.characters);
  const byId = new Map<string, BlueprintClue>();
  const all = [...locations.flatMap(placeClues), ...characters.flatMap((character) => cluesOf(character, characterName(character), "character"))];
  for (const clue of all) byId.set(clue.id, clue);
  return { byId, locations, characters };
}

function pointsTo(clue: BlueprintClue, book: ClueBook): string[] {
  const named = (items: Record<string, unknown>[], id: string, name: (item: Record<string, unknown>) => string) => {
    const found = items.find((item) => item.id === id);
    return found ? name(found) : `${id} (not in the blueprint)`;
  };
  return [
    clue.aboutCharacterId === null ? null : `about ${named(book.characters, clue.aboutCharacterId, characterName)}`,
    clue.hintLocationId === null ? null : `points to ${named(book.locations, clue.hintLocationId, (place) => text(place.name) ?? clue.hintLocationId ?? "")}`,
  ].filter((item): item is string => item !== null);
}

function panelClue(id: string, book: ClueBook, heldBefore: ReadonlySet<string>): PanelClue {
  const clue = book.byId.get(id);
  const held = heldBefore.has(id);
  if (!clue) return { id, text: null, holder: null, holderKind: null, requires: [], requiresMet: true, pointsTo: [], held, next: false };
  return {
    id,
    text: clue.text,
    holder: clue.holder,
    holderKind: clue.holderKind,
    requires: clue.requires,
    requiresMet: clue.requires.every((required) => heldBefore.has(required)),
    pointsTo: pointsTo(clue, book),
    held,
    next: false,
  };
}

/** The clue ids the player held before the turn at `sequence`: every reveal of the played turns before it, in order. */
export function heldBefore(game: StoredGame, sequence: number): string[] {
  const earlier = playedEvents(game.events).filter((event) => event.sequence < sequence).sort((a, b) => a.sequence - b.sequence);
  return [...new Set(earlier.flatMap(revealedClueIdsForEvent))];
}

const CONVERSATION = new Set(["talk", "ask", "end_talk"]);
const AT_A_PLACE = new Set(["search", "move"]);

interface Source {
  source: CluePanelView["source"];
  clues: BlueprintClue[];
  noSource: string | null;
}

function sourceOf(event: StoredEvent, book: ClueBook): Source {
  const none = (noSource: string): Source => ({ source: null, clues: [], noSource });
  if (CONVERSATION.has(event.event_type)) {
    const id = readField(event.payload, "character_id");
    if (id === null) return none(`the trace records no character_id for this ${event.event_type} turn`);
    const character = book.characters.find((item) => item.id === id);
    if (!character) return none(`the blueprint has no character "${id}"`);
    const name = characterName(character);
    return { source: { kind: "character", name }, clues: cluesOf(character, name, "character"), noSource: null };
  }
  if (AT_A_PLACE.has(event.event_type)) {
    const id = readField(event.payload, "location_id");
    if (id === null) return none(`the trace records no location_id for this ${event.event_type} turn`);
    const location = book.locations.find((item) => item.id === id);
    if (!location) return none(`the blueprint has no location "${id}"`);
    return { source: { kind: "place", name: text(location.name) ?? id }, clues: placeClues(location), noSource: null };
  }
  return none(`this ${event.event_type} turn has no speaker or place whose clues it could reveal`);
}

/** The Clues panel of `event`, a played turn of `game`. */
export function buildCluePanel(game: StoredGame, event: StoredEvent): CluePanelView {
  const book = clueBook(game.blueprint);
  const priorIds = heldBefore(game, event.sequence);
  const prior = new Set(priorIds);
  const { source, clues, noSource } = sourceOf(event, book);
  const candidates = clues.map((clue) => panelClue(clue.id, book, prior));
  if (event.event_type === "search") {
    const next = candidates.find((clue) => !clue.held && clue.requiresMet);
    if (next) next.next = true;
  }
  return {
    revealed: revealedClueIdsForEvent(event).map((id) => panelClue(id, book, prior)),
    source,
    candidates,
    noSource,
    held: priorIds.map((id) => panelClue(id, book, prior)),
  };
}
