import { describe, expect, it } from 'vitest';

import { NARRATOR_SPEAKER, createNarrationEvent, createTurnPlayedResponse } from '../../../../tests/testkit/src/fixtures';
import { linesOfTurn } from './turn-answer';

const SYSTEM = { kind: 'system' as const, key: 'system', label: 'System' };
const AGE_LINE = createNarrationEvent({
  sequence: 3,
  event_type: 'age_change',
  payload: { from: 8, to: 9 },
  narration_parts: [{ text: 'From now on, the story is written for age 9.', speaker: SYSTEM }],
});
const JUDGED = createNarrationEvent({
  sequence: 4,
  event_type: 'accuse_failed',
  narration_parts: [{ text: 'Not yet.', speaker: NARRATOR_SPEAKER }],
});

describe('linesOfTurn', () => {
  it('shows a change of age ahead of the action it was saved with', () => {
    const lines = linesOfTurn(createTurnPlayedResponse({ events: [AGE_LINE, JUDGED] }), 'explore');

    expect(lines.map((line) => line.event_type)).toEqual(['age_change', 'accuse_start']);
  });

  it('leaves an action played alone as it was', () => {
    expect(linesOfTurn(createTurnPlayedResponse({ events: [JUDGED] }), 'accuse').map((line) => line.event_type)).toEqual([
      'accuse_failed',
    ]);
  });
});
