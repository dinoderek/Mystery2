/**
 * What the labelling page shows of one turn of a stored game: the player's
 * line, the narration, the clues the turn revealed and the blueprint's ground
 * truth. Built from the stored trace alone, so it holds no judge finding.
 */

import { playedEvents, readField, revealedClueIdsForEvent } from "../lib/game-events.ts";
import type { Label, StoredGame } from "../lib/truth/schemas.ts";

type StoredEvent = StoredGame["events"][number];

export interface ClueView {
  id: string;
  /** Null when the blueprint has no clue by that id. */
  text: string | null;
}

export interface GroundTruthView {
  whatHappened: string | null;
  whyItHappened: string | null;
  timeline: string[];
  culprit: string | null;
}

export interface TurnView {
  sequence: number;
  eventType: string;
  /** Where this turn stands in the list being labelled, from 1. */
  position: number;
  total: number;
  playerLine: string;
  narration: string;
  clues: ClueView[];
  groundTruth: GroundTruthView;
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

/** The turns of a stored game, in order: what the game master played, without the refused lines saved beside them. */
export function playedTurns(game: StoredGame): StoredEvent[] {
  return playedEvents(game.events).sort((a, b) => a.sequence - b.sequence);
}

function nameOf(items: unknown, id: string | null): string | null {
  const found = records(items).find((item) => item.id === id);
  return text(found?.name) ?? text(found?.first_name);
}

function playerLine(event: StoredEvent, blueprint: Record<string, unknown>): string {
  const world = record(blueprint.world);
  const typed = readField(event.payload, "player_reasoning") ?? readField(event.payload, "player_input") ?? readField(event.payload, "search_query");
  if (typed) return typed;
  const place = nameOf(world.locations, readField(event.payload, "location_id"));
  switch (event.event_type) {
    case "start":
      return "(the game begins)";
    case "move":
      return `(moves to ${place ?? "another place"})`;
    case "search":
      return `(searches ${place ?? "the place"})`;
    case "talk":
      return `(starts talking to ${readField(event.payload, "character_name") ?? "someone"})`;
    case "end_talk":
      return "(ends the conversation)";
    case "accuse_start":
      return "(starts the accusation)";
    default:
      return `(${event.event_type})`;
  }
}

/** Every clue text in a blueprint, by id: places, their sub-places and characters. */
function clueTexts(blueprint: Record<string, unknown>): Map<string, string> {
  const world = record(blueprint.world);
  const holders = records(world.locations).flatMap((location) => [location, ...records(location.sub_locations)]);
  const found = new Map<string, string>();
  for (const holder of [...holders, ...records(world.characters)]) {
    for (const clue of records(holder.clues)) {
      const id = text(clue.id);
      const clueText = text(clue.text);
      if (id && clueText) found.set(id, clueText);
    }
  }
  return found;
}

function groundTruthOf(blueprint: Record<string, unknown>): GroundTruthView {
  const truth = record(blueprint.ground_truth);
  const culprit = records(record(blueprint.world).characters).find((character) => character.is_culprit === true);
  const name = culprit ? [text(culprit.first_name), text(culprit.last_name)].filter(Boolean).join(" ") : "";
  return {
    whatHappened: text(truth.what_happened),
    whyItHappened: text(truth.why_it_happened),
    timeline: Array.isArray(truth.timeline) ? truth.timeline.filter((line): line is string => typeof line === "string") : [],
    culprit: name || null,
  };
}

/** The view of the turn at `sequence`; `position` and `total` place it in the list being labelled. */
export function buildTurnView(game: StoredGame, sequence: number, position: number, total: number): TurnView {
  const event = game.events.find((candidate) => candidate.sequence === sequence);
  if (!event) throw new Error(`game "${game.session.id}" has no turn ${sequence}`);
  const blueprint = game.blueprint as Record<string, unknown>;
  const texts = clueTexts(blueprint);
  return {
    sequence,
    eventType: event.event_type,
    position,
    total,
    playerLine: playerLine(event, blueprint),
    narration: event.narration,
    clues: revealedClueIdsForEvent(event).map((id) => ({ id, text: texts.get(id) ?? null })),
    groundTruth: groundTruthOf(blueprint),
  };
}

/** What a turn's latest label says, as the form shows it: the kinds, one severity and one note. */
export interface FormState {
  kinds: string[];
  severity: "minor" | "major";
  note: string;
}

export const EMPTY_FORM: FormState = { kinds: [], severity: "minor", note: "" };

/** The form a turn's latest label fills in; the worst severity and the first note when the faults differ. */
export function formFromLabel(label: Label | null): FormState {
  if (!label || label.faults.length === 0) return { ...EMPTY_FORM };
  return {
    kinds: [...new Set(label.faults.map((fault) => fault.kind))],
    severity: label.faults.some((fault) => fault.severity === "major") ? "major" : "minor",
    note: label.faults[0].note,
  };
}
