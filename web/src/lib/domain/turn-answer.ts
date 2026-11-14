// What a `game-turn` answer puts on the screen.

import type { TurnPlayedResponse } from '@my2/shared';
import type { GameState, NarrationEvent } from '../types/game';

/** A turn's events as the transcript shows them; the store numbers them. */
export type TurnLine = Omit<NarrationEvent, 'sequence'>;

/**
 * An accusation made with its reasoning in one line is saved as its first
 * round, which on its own would continue the page already open. On screen it
 * opens the accusation, as `accuse` alone does.
 */
function presentedType(eventType: string, playedIn: GameState['mode']): string {
  const isRound = eventType === 'accuse_round' || eventType === 'accuse_resolved';
  return isRound && playedIn === 'explore' ? 'accuse_start' : eventType;
}

/** The events the turn saved, as transcript lines. `playedIn` is the mode the line was typed in. */
export function linesOfTurn(answer: TurnPlayedResponse, playedIn: GameState['mode']): TurnLine[] {
  return answer.events.map((event, index) => ({
    event_type: index === 0 ? presentedType(event.event_type, playedIn) : event.event_type,
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
