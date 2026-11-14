// What the browser keeps of a game, built from what the server sent.

import type {
  GameState as WireGameState,
  NarrationEvent as WireNarrationEvent,
  SessionCatalogResponse,
  SessionSummary as WireSessionSummary,
} from '@my2/shared';
import type { GameState, NarrationEvent, SessionCatalog, SessionSummary } from '../types/game';

export const EMPTY_CATALOG: SessionCatalog = {
  in_progress: [],
  completed: [],
  counts: { in_progress: 0, completed: 0 },
};

/**
 * The server names where a character stands by id; the browser's cast carries
 * it as `location_name`, which the status bar and the notebook match against
 * either an id or a name.
 */
export function toGameState(state: WireGameState, history: WireNarrationEvent[]): GameState {
  return {
    mystery_summary: state.mystery_summary ?? null,
    premise: state.premise ?? null,
    locations: state.locations,
    characters: state.characters.map((character) => ({
      id: character.id,
      first_name: character.first_name,
      last_name: character.last_name,
      location_name: character.location_id,
      sex: character.sex,
      summary: character.summary,
    })),
    discovered_clues: state.discovered_clues ?? [],
    time_remaining: state.time_remaining,
    location: state.location,
    mode: state.mode,
    current_talk_character: state.current_talk_character,
    history: history as NarrationEvent[],
  };
}

function compareSessionSummaries(a: SessionSummary, b: SessionSummary): number {
  const byLastPlayed = b.last_played_at.localeCompare(a.last_played_at);
  if (byLastPlayed !== 0) {
    return byLastPlayed;
  }

  const byCreated = b.created_at.localeCompare(a.created_at);
  if (byCreated !== 0) {
    return byCreated;
  }

  return b.game_id.localeCompare(a.game_id);
}

export function sortSessionSummaries(summaries: SessionSummary[]): SessionSummary[] {
  return [...summaries].sort(compareSessionSummaries);
}

function toSessionSummary(summary: WireSessionSummary): SessionSummary {
  return {
    ...summary,
    can_open: summary.can_open && summary.mystery_available,
    outcome: summary.outcome ?? null,
  };
}

/** Most recently played first; each list keeps only the sessions its mode belongs to. */
export function toSessionCatalog(response: SessionCatalogResponse): SessionCatalog {
  const inProgress = sortSessionSummaries(
    response.in_progress.map(toSessionSummary).filter((summary) => summary.mode !== 'ended'),
  );
  const completed = sortSessionSummaries(
    response.completed.map(toSessionSummary).filter((summary) => summary.mode === 'ended'),
  );
  return {
    in_progress: inProgress,
    completed,
    counts: { in_progress: inProgress.length, completed: completed.length },
  };
}
