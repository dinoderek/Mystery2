import type { SessionOutcome, SessionSummary } from '$lib/types/game';

function readDate(value: string): Date | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

export function formatLastPlayed(value: string): string {
  const parsed = readDate(value);
  if (!parsed) {
    return 'Unknown';
  }

  return parsed.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function formatOutcome(outcome: SessionOutcome): string {
  if (outcome === 'win') {
    return 'Solved';
  }

  if (outcome === 'lose') {
    return 'Unsolved';
  }

  return 'Unknown';
}

export function pickSessionByNumericKey(
  key: string,
  sessions: SessionSummary[],
): SessionSummary | null {
  const index = Number.parseInt(key, 10);
  if (!Number.isFinite(index) || index < 1 || index > sessions.length) {
    return null;
  }

  return sessions[index - 1];
}
