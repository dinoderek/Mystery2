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
import type { Given, TurnAction } from "./case.ts";
import type { TurnResponse } from "./transcript.ts";

export const TURN_SCHEMA_VERSION = "0.2";
export const TURN_FILE = "turn.json";

export interface StoredTurn {
  schema_version: string;
  run_id: string;
  started_at: string;
  ended_at: string;
  case_id: string;
  /** Who narrated: `server`, or a narrator binding's name. */
  narrator: string;
  /** The model behind the narration: a binding's model with its name, or the profile a server was asked for. */
  model: string;
  blueprint_path: string;
  target_age: number | null;
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
  targetAge: number | null;
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
    target_age: input.targetAge,
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
