// Lines that cost no turn: a refused line, and `help`. Each is saved as one
// event holding the line as typed and the answer the player read, so a resumed
// game shows what the live game showed. The save changes nothing in the
// session, and the event is no part of what the game master did, so it never
// reaches the narrator's history.

import {
  NO_TURN_EVENT_TYPE,
  type GameTurnResponse,
  type NoTurnLinePayload,
} from "../../../shared/src/mystery-api-contracts.ts";
import type { GameEventRow, SaveEvent } from "../context.ts";
import { createNarrationPart } from "../narration.ts";
import { SYSTEM_SPEAKER } from "../speaker.ts";

/**
 * The event that records `input` and the answer to it, or null when the answer
 * is not kept. A blank line is nothing a player typed, so it is not kept.
 */
export function noTurnEvent(input: string, answer: GameTurnResponse): SaveEvent | null {
  const payload = input === "" ? null : noTurnPayload(input, answer);
  const text = answer.kind === "refused" ? answer.hint : answer.kind === "view" ? answer.note : null;
  if (!payload || !text) return null;

  return {
    event_type: NO_TURN_EVENT_TYPE,
    actor: "system",
    payload,
    narration: text,
    narration_parts: [createNarrationPart(text, SYSTEM_SPEAKER)],
    model: null,
  };
}

function noTurnPayload(input: string, answer: GameTurnResponse): NoTurnLinePayload | null {
  if (answer.kind === "refused") return { input, answered: "refused", reason: answer.reason };
  if (answer.kind === "view" && answer.view === "help") return { input, answered: "help" };
  return null;
}

/** The events the game master took part in: everything but the lines that cost no turn. */
export function playedEvents<T extends { event_type: string }>(events: T[]): T[] {
  return events.filter((event) => event.event_type !== NO_TURN_EVENT_TYPE);
}

/** The sequence the next event takes, counting every saved event. */
export function nextSequenceAfter(events: Pick<GameEventRow, "sequence">[]): number {
  return (events.at(-1)?.sequence ?? 0) + 1;
}
