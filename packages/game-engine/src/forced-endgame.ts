import {
  createNarrationDiagnostics,
  type InsertNarrationEventInput,
  type NarrationPart,
} from "./narration.ts";
import { NARRATOR_SPEAKER } from "./speaker.ts";
import type { LogWriter } from "./logging.ts";

/** The forced accusation's event, saved straight after the action that spent the last turn. */
export function forcedEndgameEvent(input: {
  session_id: string;
  action: string;
  action_sequence: number;
  payload: Record<string, unknown>;
  narration_parts: NarrationPart[];
  model?: string | null;
  reading_age: number;
  time_after: number;
}): InsertNarrationEventInput {
  return {
    session_id: input.session_id,
    event_type: "forced_endgame",
    actor: "system",
    payload: {
      role: "accusation_start",
      ...input.payload,
      trigger: "timeout",
      speaker: NARRATOR_SPEAKER,
    },
    narration_parts: input.narration_parts,
    model: input.model ?? null,
    reading_age: input.reading_age,
    diagnostics: createNarrationDiagnostics({
      action: input.action,
      event_category: "forced_endgame",
      mode: "accuse",
      resulting_mode: "accuse",
      time_before: input.time_after,
      time_after: input.time_after,
      time_consumed: false,
      forced_endgame: true,
      trigger: "timeout",
      related_sequence: input.action_sequence,
    }),
  };
}

/** Logs the move into the accusation that running out of turns forced. */
export function logTimeoutTransition(
  logger: LogWriter,
  input: {
    game_id: string;
    action: string;
    time_before: number;
    time_after: number;
    resulting_mode: string;
    action_sequence: number;
    forced_endgame_sequence: number;
  },
): void {
  logger.log("timeout.transition", input);
}
