// What a resolved action does to the game: the turn it spends, the accusation
// that running out of turns forces, the session change and the events to save.
// Pure: it takes data and returns data, so every rule here is unit-tested.

import type { TurnState } from "../../../shared/src/mystery-api-contracts.ts";
import type { GameSessionPatch, GameSessionRow, SaveEvent } from "../context.ts";
import { forcedEndgameEvent } from "../forced-endgame.ts";
import {
  buildNarrationEvent,
  createNarrationDiagnostics,
  type InsertNarrationEventInput,
} from "../narration.ts";
import type { GameMode } from "../state-machine.ts";
import type { ActionOutcome, ForcedEndgame } from "./types.ts";

export interface TurnCost {
  time_before: number;
  time_after: number;
  time_consumed: boolean;
  /** The action spent the last turn, so the accusation starts now. */
  forced_endgame: boolean;
}

/** A turn costs one, never below zero; spending the last one forces the accusation. */
export function spendTurn(timeRemaining: number, costsTurn: boolean): TurnCost {
  const timeAfter = costsTurn ? Math.max(timeRemaining - 1, 0) : timeRemaining;
  return {
    time_before: timeRemaining,
    time_after: timeAfter,
    time_consumed: costsTurn,
    forced_endgame: costsTurn && timeAfter === 0,
  };
}

/** One event as the save writes it, with what logging it needs. */
export interface PlannedEvent {
  sequence: number;
  record: InsertNarrationEventInput;
  event: SaveEvent;
}

export interface TurnEffect {
  patch: GameSessionPatch;
  events: PlannedEvent[];
  state: TurnState;
  resulting_mode: GameMode;
}

export interface TurnEffectInput {
  game_id: string;
  session: GameSessionRow;
  outcome: ActionOutcome;
  cost: TurnCost;
  /** The forced accusation's narration, when `cost.forced_endgame`. */
  forced: ForcedEndgame | null;
  /** The line as the player typed it. */
  input: string;
  /** The sequence the first event takes. */
  expected_sequence: number;
  now: string;
}

function planEvent(record: InsertNarrationEventInput, sequence: number): PlannedEvent {
  return { sequence, record, event: buildNarrationEvent(record, sequence) };
}

function actionRecord(input: TurnEffectInput, resultingMode: GameMode): InsertNarrationEventInput {
  const { event } = input.outcome;
  return {
    session_id: input.game_id,
    event_type: event.event_type,
    actor: event.actor,
    payload: { ...event.payload, input: input.input },
    narration_parts: event.narration_parts,
    model: event.model,
    diagnostics: createNarrationDiagnostics({
      action: event.action,
      event_category: event.event_type,
      mode: event.mode,
      resulting_mode: resultingMode,
      time_before: input.cost.time_before,
      time_after: input.cost.time_after,
      time_consumed: input.cost.time_consumed,
      forced_endgame: input.cost.forced_endgame,
      trigger: "player",
    }),
  };
}

function forcedRecord(input: TurnEffectInput, forced: ForcedEndgame): InsertNarrationEventInput {
  if (!input.outcome.endgame) {
    throw new Error(`Action ${input.outcome.event.action} spent the last turn but sets no accusation scene`);
  }
  return forcedEndgameEvent({
    session_id: input.game_id,
    action: input.outcome.event.action,
    action_sequence: input.expected_sequence,
    payload: input.outcome.endgame.payload,
    narration_parts: forced.narration_parts,
    model: forced.model,
    time_after: input.cost.time_after,
  });
}

function stateAfter(session: GameSessionRow, patch: GameSessionPatch, mode: GameMode, time: number): TurnState {
  return {
    mode,
    time_remaining: time,
    location: patch.current_location_id ?? session.current_location_id,
    current_talk_character:
      patch.current_talk_character_id === undefined
        ? session.current_talk_character_id
        : patch.current_talk_character_id,
  };
}

/** The whole of one turn's write, and where the game stands after it. */
export function turnEffect(input: TurnEffectInput): TurnEffect {
  const { outcome, cost } = input;
  if (cost.forced_endgame && !input.forced) {
    throw new Error("A turn that forces the accusation needs its narration");
  }
  const resultingMode: GameMode = cost.forced_endgame ? "accuse" : outcome.resulting_mode;

  const patch: GameSessionPatch = {
    ...outcome.patch,
    mode: resultingMode,
    time_remaining: cost.time_after,
    // Nobody is being talked to once the accusation has begun.
    ...(cost.forced_endgame ? { current_talk_character_id: null } : {}),
    updated_at: input.now,
  };

  const events = [planEvent(actionRecord(input, resultingMode), input.expected_sequence)];
  if (cost.forced_endgame && input.forced) {
    events.push(planEvent(forcedRecord(input, input.forced), input.expected_sequence + 1));
  }

  return {
    patch,
    events,
    state: stateAfter(input.session, patch, resultingMode, cost.time_after),
    resulting_mode: resultingMode,
  };
}
