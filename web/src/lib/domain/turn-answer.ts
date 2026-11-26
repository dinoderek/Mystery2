// What a `game-turn` answer puts on the screen.

import { AGE_CHANGE_EVENT_TYPE, type TurnPlayedResponse } from '@my2/shared';
import type { GameState, NarrationEvent } from '../types/game';

/** A turn's events as the transcript shows them; the store numbers them. */
export type TurnLine = Omit<NarrationEvent, 'sequence'>;

/**
 * An accusation made with its reasoning in one line is saved as the judged
 * accusation alone, which would continue the page already open. On screen it
 * opens the accusation, as `accuse` alone does.
 */
function presentedType(eventType: string, playedIn: GameState['mode']): string {
  const isJudged = eventType === 'accuse_failed' || eventType === 'accuse_resolved';
  return isJudged && playedIn === 'explore' ? 'accuse_start' : eventType;
}

/**
 * The events the turn saved, as transcript lines. `playedIn` is the mode the
 * line was typed in. A change of age is saved ahead of the action, which is
 * the first event that is not one.
 */
export function linesOfTurn(answer: TurnPlayedResponse, playedIn: GameState['mode']): TurnLine[] {
  const action = answer.events.findIndex((event) => event.event_type !== AGE_CHANGE_EVENT_TYPE);
  return answer.events.map((event, index) => ({
    event_type: index === action ? presentedType(event.event_type, playedIn) : event.event_type,
    narration_parts: event.narration_parts,
    payload: event.payload,
  }));
}

/** The clues this turn found that the notebook does not hold yet. */
export function freshClues<T extends { id: string }>(known: Array<{ id: string }>, found: T[]): T[] {
  const seen = new Set(known.map((clue) => clue.id));
  const fresh: T[] = [];
  for (const clue of found) {
    if (!seen.has(clue.id)) {
      seen.add(clue.id);
      fresh.push(clue);
    }
  }
  return fresh;
}
