import { describe, expect, it } from 'vitest';

import { formatLastPlayed, formatOutcome, pickSessionByNumericKey } from './session-list';
import type { SessionSummary } from '../types/game';
import { createSessionSummary } from '../../../../tests/testkit/src/fixtures';

describe('formatLastPlayed', () => {
  it('shows a timestamp as UTC to the minute', () => {
    expect(formatLastPlayed('2026-03-04T05:06:07.890Z')).toBe('2026-03-04 05:06 UTC');
  });

  it('shows Unknown for a value that is not a date', () => {
    expect(formatLastPlayed('yesterday-ish')).toBe('Unknown');
    expect(formatLastPlayed('')).toBe('Unknown');
  });
});

describe('formatOutcome', () => {
  it('names a win Solved and a loss Unsolved', () => {
    expect(formatOutcome('win')).toBe('Solved');
    expect(formatOutcome('lose')).toBe('Unsolved');
  });

  it('shows Unknown for a game with no outcome yet', () => {
    expect(formatOutcome(null)).toBe('Unknown');
  });
});

describe('pickSessionByNumericKey', () => {
  const sessions: SessionSummary[] = [
    createSessionSummary({ game_id: '11111111-1111-4111-8111-111111111111' }),
    createSessionSummary({ game_id: '22222222-2222-4222-8222-222222222222' }),
  ].map((session) => ({
    ...session,
    outcome: session.outcome ?? null,
  }));

  it('picks the session listed under that number, counting from 1', () => {
    expect(pickSessionByNumericKey('1', sessions)?.game_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(pickSessionByNumericKey('2', sessions)?.game_id).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('picks nothing for zero, a number past the list, or a non-number', () => {
    expect(pickSessionByNumericKey('0', sessions)).toBeNull();
    expect(pickSessionByNumericKey('3', sessions)).toBeNull();
    expect(pickSessionByNumericKey('-1', sessions)).toBeNull();
    expect(pickSessionByNumericKey('x', sessions)).toBeNull();
    expect(pickSessionByNumericKey('1', [])).toBeNull();
  });
});
