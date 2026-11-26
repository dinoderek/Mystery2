// The change of reading age, recorded once. The profile's age is read on every
// request; when it differs from the last age this game recorded, the engine
// saves one `age_change` event before anything is narrated, so the transcript
// says where the story's reading level moved. It is engine-written text, the
// same for every age, and no part of what the game master did.

import {
  AGE_CHANGE_EVENT_TYPE,
  type AgeChangePayload,
} from "../../../shared/src/mystery-api-contracts.ts";
import type { EngineContext, GameEventRow, SaveEvent } from "../context.ts";
import { SaveConflictError } from "../errors.ts";
import type { LogWriter } from "../logging.ts";
import { createNarrationPart, logNarrationEventSaved } from "../narration.ts";
import { SYSTEM_SPEAKER } from "../speaker.ts";

/** What the player reads when the age changed. */
export function ageChangeLine(to: number): string {
  return `From now on, the story is written for age ${to}.`;
}

type AgeBearing = Pick<GameEventRow, "event_type" | "payload">;

function ageOf(event: AgeBearing): number | null {
  const payload = event.payload;
  if (typeof payload !== "object" || payload === null) return null;
  const recorded = event.event_type === AGE_CHANGE_EVENT_TYPE ? payload.to : payload.reading_age;
  return typeof recorded === "number" ? recorded : null;
}

/**
 * The age the game last recorded: the newest narrated event's `reading_age`,
 * or the `to` of a change saved since. Null for a game with neither.
 */
export function lastRecordedAge(events: readonly AgeBearing[]): number | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const age = ageOf(events[index]);
    if (age !== null) return age;
  }
  return null;
}

/**
 * The `age_change` to save before the next narration: the game moved from the
 * age it last recorded to `to`. Null when it recorded none, or already `to`.
 */
export function ageChange(recorded: number | null, to: number): SaveEvent | null {
  if (recorded === null || recorded === to) return null;

  const payload: AgeChangePayload = { from: recorded, to };
  const line = ageChangeLine(to);
  return {
    event_type: AGE_CHANGE_EVENT_TYPE,
    actor: "system",
    payload,
    narration: line,
    narration_parts: [createNarrationPart(line, SYSTEM_SPEAKER)],
    model: null,
  };
}

/**
 * Opening a game: saves the `age_change` when the profile's age differs from
 * the last one the game recorded, so a change made in settings shows its line
 * on the next screen. Returns whether it saved one; the caller then rereads
 * the events. A turn saved meanwhile conflicts and leaves the change for the
 * next request, which sees it again.
 */
export async function recordAgeOnOpen(
  ctx: EngineContext,
  game: { game_id: string; events: readonly GameEventRow[]; reading_age: number },
  request: { request_id: string; logger: LogWriter },
): Promise<boolean> {
  const change = ageChange(lastRecordedAge(game.events), game.reading_age);
  if (!change) return false;

  const sequence = (game.events.at(-1)?.sequence ?? 0) + 1;
  try {
    await ctx.sessions.saveTurn({
      game_id: game.game_id,
      expected_sequence: sequence,
      request_id: request.request_id,
      events: [change],
    });
  } catch (error) {
    if (!(error instanceof SaveConflictError)) throw error;
    request.logger.log("request.conflict", { error: error.message, recording: AGE_CHANGE_EVENT_TYPE });
    return false;
  }
  logNarrationEventSaved(
    {
      session_id: game.game_id,
      event_type: change.event_type,
      actor: change.actor,
      narration_parts: change.narration_parts,
      logger: request.logger,
    },
    sequence,
  );
  return true;
}
