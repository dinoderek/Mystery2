/**
 * The captured turn: what one replayed action produced, stored beside its
 * `result.json` as `turn.json`. It is written before any judge runs and is the
 * source of truth for judging again, so a judge never needs the narrator.
 *
 * A case evaluates one action against fixed prior state, so the capture records
 * `given` (the exact prior state and history) and `action` (the event under
 * test) for full reproducibility, plus the single `response`. The shape is its
 * own, versioned apart from `result.json`.
 */

import fs from "node:fs/promises";

import { UsageError } from "../../core/errors.ts";
import { readingAgeOf } from "../../lib/game-events.ts";
import type { Given, TurnAction } from "./case.ts";
import type { TurnResponse } from "./transcript.ts";

export const TURN_SCHEMA_VERSION = "0.3";
export const TURN_FILE = "turn.json";

export interface StoredTurn {
  schema_version: string;
  run_id: string;
  started_at: string;
  ended_at: string;
  case_id: string;
  /** The event sequence a turn taken from a stored game has there; absent on a replayed case. */
  sequence?: number;
  /** Who narrated: `server`, or a narrator binding's name. */
  narrator: string;
  /** The model behind the narration: a binding's model with its name, or the profile a server was asked for. */
  model: string;
  blueprint_path: string;
  /** The age the turn was narrated at: its case's, or its event's in a stored game. */
  reading_age: number;
  given: Given;
  action: TurnAction;
  response: TurnResponse;
  timing: { total_ms: number };
}

export interface TurnInput {
  runId: string;
  startedAt: string;
  endedAt: string;
  caseId: string;
  narrator: string;
  model: string;
  blueprintPath: string;
  readingAge: number;
  given: Given;
  action: TurnAction;
  response: TurnResponse;
  totalMs: number;
}

/** The raw, judge-independent capture. */
export function buildTurn(input: TurnInput): StoredTurn {
  return {
    schema_version: TURN_SCHEMA_VERSION,
    run_id: input.runId,
    started_at: input.startedAt,
    ended_at: input.endedAt,
    case_id: input.caseId,
    narrator: input.narrator,
    model: input.model,
    blueprint_path: input.blueprintPath,
    reading_age: input.readingAge,
    given: input.given,
    action: input.action,
    response: input.response,
    timing: { total_ms: input.totalMs },
  };
}

/** Whether a parsed JSON value is a captured turn, as opposed to a case. */
export function isStoredTurn(value: unknown): value is StoredTurn {
  const candidate = value as Partial<StoredTurn> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.schema_version === "string" &&
    typeof candidate.case_id === "string" &&
    typeof candidate.response === "object" &&
    candidate.response !== null
  );
}

/** Reads a captured turn, refusing a file that is not one. */
export async function readStoredTurn(file: string): Promise<StoredTurn> {
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    throw new UsageError(`cannot read stored turn ${file}: ${(error as Error).message}`);
  }
  if (!isStoredTurn(value)) throw new UsageError(`${file} is not a stored turn`);
  if (value.schema_version !== TURN_SCHEMA_VERSION) {
    throw new UsageError(`${file} is stored turn version ${value.schema_version}; this reads ${TURN_SCHEMA_VERSION}`);
  }
  return value;
}

/** The `narrator` of a turn taken from a stored game: nobody narrated it again. */
export const STORED_NARRATOR = "stored";

/** What a trace's event holds of the turn. */
export interface StoredEvent {
  sequence: number;
  event_type: string;
  narration?: string;
  narration_parts?: unknown;
  payload?: Record<string, unknown> | null;
  model?: string | null;
}

/**
 * A turn as a played game already holds it. The narration is the event's own,
 * byte for byte, so a judge reads what the player was shown and no narrator is
 * asked again, at the age the event records it was written at. `gameId` keeps
 * two games' turns apart in one run. An event without its age is refused.
 */
export function turnFromEvent(
  event: StoredEvent,
  game: { id: string; blueprintPath: string },
): StoredTurn {
  const readingAge = readingAgeOf(event);
  const narration = event.narration ?? "";
  const parts = Array.isArray(event.narration_parts) ? (event.narration_parts as TurnResponse["narration_parts"]) : [];
  const playerInput = event.payload?.player_input;
  return {
    schema_version: TURN_SCHEMA_VERSION,
    run_id: "",
    started_at: "",
    ended_at: "",
    case_id: `${game.id}__s${event.sequence}-${event.event_type}`,
    sequence: event.sequence,
    narrator: STORED_NARRATOR,
    model: STORED_NARRATOR,
    blueprint_path: game.blueprintPath,
    reading_age: readingAge,
    given: {},
    action: { type: event.event_type, ...(typeof playerInput === "string" ? { player_input: playerInput } : {}) },
    response: {
      action: event.event_type,
      request: {},
      narration_parts: parts,
      narration_text: narration,
      speaker: null,
      prompt: null,
      raw: null,
    },
    timing: { total_ms: 0 },
  };
}
