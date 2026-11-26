// Shared reading of the runtime's persisted game_events rows.
//
// Both evaluation subjects are built from the same event shape
// (event_type/actor/narration/payload): the trace pipeline reads rows straight
// out of the game database, and a runtime-harness case authors the same shape as
// its fixed `given.history`. The mapping from an event to (a) the AI role that
// produced it and (b) the clue ids it revealed therefore has to be identical on
// both sides, so it lives here rather than in either harness.
//
// Sibling of evaluation/lib/readability.ts — the other module shared across
// harnesses.

import { ACCUSE_FAILED, ACCUSE_RESOLVED } from "../../packages/game-engine/src/accusations.ts";
import { NO_TURN_EVENT_TYPE } from "../../packages/shared/src/mystery-api-contracts.ts";

/** A round inside the accusation, in games recorded before each accusation was one shot. */
export const LEGACY_ACCUSE_ROUND = "accuse_round";

// A refused line and `help` are saved as events of their own, so a resumed game
// shows them. They are not something the game master did: every reader that
// follows the game master's play takes its events through this, so its output is
// the same with or without them.
/** A game event as the trace stores it and a case writes it: the fields the readers below use. */
export interface GameEventLike {
  event_type: string;
  payload?: Record<string, unknown> | null;
  narration?: string;
  clues_revealed?: string[];
}

export function playedEvents<T extends GameEventLike>(events: readonly T[]): T[] {
  return events.filter((event) => event.event_type !== NO_TURN_EVENT_TYPE);
}

// Maps a persisted event_type to the AI role whose context builder applies.
// Event types with no game-master AI role (e.g. the opening "start" block) map
// to null and get a turn record without a reconstructed context.
//
// Note: "move" is an internal label for selecting buildMoveContext, which stamps
// its context with role_name "ambience" (the arrival narration role); "move"
// reads more clearly in turn records and judge projections, and never reaches a
// builder as a role string.
export const EVENT_ROLE: Readonly<Record<string, string>> = {
  move: "move",
  search: "search",
  talk: "talk_start",
  ask: "talk_conversation",
  end_talk: "talk_end",
  accuse_start: "accusation_start",
  [ACCUSE_FAILED]: "accusation_judge",
  [LEGACY_ACCUSE_ROUND]: "accusation_judge",
  [ACCUSE_RESOLVED]: "accusation_judge",
  forced_endgame: "accusation_start",
};

// Only the closing scene tells the truth. Opening the accusation, and a failed
// accusation's reply, come before it, so spoiler-sensitive checks judge them
// like any other turn.
export const CLOSING_SCENE_EVENT_TYPES: ReadonlySet<string> = new Set([ACCUSE_RESOLVED]);

export function readField(payload: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function readStringArray(payload: Record<string, unknown> | null | undefined, key: string): string[] {
  if (!payload || typeof payload !== "object") return [];
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

// The clue ids revealed by a single event THIS TURN. The runtime persists
// reveals differently per event type, and conflating them double-counts:
//   - `search` stores this turn's single find in payload.revealed_clue_id;
//     its payload.revealed_clue_ids is the CUMULATIVE list of everything
//     revealed in that location so far (`turn/resolve-clue-graph.ts` in the engine), NOT a per-turn
//     delta — using it as a delta makes clue-accounting false-fail.
//   - `ask` stores this turn's reveals as the payload.revealed_clue_ids array
//     (`turn/resolve-talk.ts` in the engine).
// The clues_revealed column is never written by the runtime; we honor it only
// as a fallback for legacy/seeded rows on non-search/ask events.
export function revealedClueIdsForEvent(event: GameEventLike): string[] {
  const payload = event.payload ?? null;
  if (event.event_type === "search") {
    const single = readField(payload, "revealed_clue_id");
    return single ? [single] : [];
  }
  if (event.event_type === "ask") {
    return readStringArray(payload, "revealed_clue_ids");
  }
  // A clue-graph greeting hands out a character's first words.
  if (event.event_type === "talk" && payload?.clue_graph !== undefined) {
    return readStringArray(payload, "revealed_clue_ids");
  }
  return (event.clues_revealed ?? []).filter(
    (id) => typeof id === "string" && id.length > 0,
  );
}

// The notebook lines a clue-graph turn saved, by clue id: what the player keeps
// for each clue it brought out. Null for any other turn.
export function notebookLinesForEvent(event: GameEventLike): Record<string, string> | null {
  const recorded = event.payload?.clue_graph;
  const notebook = typeof recorded === "object" && recorded !== null ? (recorded as { notebook?: unknown }).notebook : undefined;
  if (typeof notebook !== "object" || notebook === null || Array.isArray(notebook)) return null;
  const lines = Object.entries(notebook).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return lines.length > 0 ? Object.fromEntries(lines) : null;
}

/** Whether the narrator wrote this event: the engine records its model then. */
export function isNarrated(event: { model?: string | null }): boolean {
  return typeof event.model === "string" && event.model.length > 0;
}

// The age a narrated event was written at, as the engine recorded it in its
// payload. Each turn is judged at its own: the reader's age can change between
// two turns, and the case has none. A game recorded before events carried it
// (an old trace) is refused by name rather than judged at a guessed age.
export function readingAgeOf(event: Pick<GameEventLike, "event_type" | "payload"> & { sequence?: number }): number {
  const age = event.payload?.reading_age;
  if (typeof age === "number" && Number.isInteger(age)) return age;
  const which = event.sequence === undefined ? event.event_type : `${event.sequence} (${event.event_type})`;
  throw new Error(
    `event ${which} has no reading_age: it was recorded before narrated events carried the age they were written at, so it cannot be judged`,
  );
}
