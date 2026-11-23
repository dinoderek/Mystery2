// How many accusations a game has, derived from its events alone, so a live
// game, a resumed one and a replay count the same (`docs/game.md`, "The
// accusation"). Each judged accusation saves one event: `accuse_failed` when it
// spends one and play goes on, `accuse_resolved` when it ends the case.

/** The accusations a game starts with. */
export const ACCUSATIONS = 3;

/** A judged accusation that spent one and did not end the case. */
export const ACCUSE_FAILED = "accuse_failed";
/** A judged accusation that ended the case, won or lost. */
export const ACCUSE_RESOLVED = "accuse_resolved";
/** `back` out of the accusation scene, which spends nothing. */
export const ACCUSE_BACK = "accuse_back";

interface AccusationEvent {
  event_type: string;
  payload?: Record<string, unknown> | null;
}

/** Whether an event is a judged accusation that did not win. */
function spendsOne(event: AccusationEvent): boolean {
  if (event.event_type === ACCUSE_FAILED) return true;
  return event.event_type === ACCUSE_RESOLVED && event.payload?.judge_result === "lose";
}

/** The accusations spent so far. */
export function accusationsSpent(events: AccusationEvent[]): number {
  return events.filter(spendsOne).length;
}

/** The accusations left, never below zero. */
export function accusationsLeft(events: AccusationEvent[]): number {
  return Math.max(ACCUSATIONS - accusationsSpent(events), 0);
}

/** Whether the accusation about to be judged is the last one. */
export function isLastAccusation(events: AccusationEvent[]): boolean {
  return accusationsLeft(events) <= 1;
}

/** Out of turns, the accusation is forced: there is no way back to exploring. */
export function accusationForced(session: { mode: string; time_remaining: number }): boolean {
  return session.mode === "accuse" && session.time_remaining === 0;
}
