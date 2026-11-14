import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, getMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  getMock: vi.fn(),
}));

vi.mock('../api/client', () => ({
  callApi: invokeMock,
  callApiGet: getMock,
  blueprintImageUrl: (blueprintId: string, imageId: string) =>
    `/api/images/${blueprintId}/${imageId}`,
}));

import { NO_TURN_EVENT_TYPE } from '@my2/shared';
import { GameSessionStore } from './store.svelte';
import {
  INVESTIGATOR_SPEAKER,
  NARRATOR_SPEAKER,
  createGameGetResponse,
  createGameState,
  createNarrationEvent,
  createTurnPlayedResponse,
  createTurnRefusedResponse,
  createTurnViewResponse,
} from '../../../../tests/testkit/src/fixtures';
import type { NarrationEvent } from '../types/game';

const SYSTEM_SPEAKER = { kind: 'system' as const, key: 'system', label: 'System' };
const HINT = "Commands: move to/go to <location>, search, help.";
const HELP = 'Help menu opened.';

const START = createNarrationEvent({ sequence: 1, event_type: 'start', narration_parts: [{ text: 'Case begins.', speaker: NARRATOR_SPEAKER }] });
const ARRIVAL = createNarrationEvent({
  sequence: 2,
  event_type: 'move',
  payload: { location_name: 'Kitchen', role: 'enter' },
  narration_parts: [{ text: 'The kitchen.', speaker: NARRATOR_SPEAKER }],
});

/** What the player reads: each page, with its lines and who said them. */
function shown(store: GameSessionStore) {
  return store.pages.map((page) => ({
    kind: page.kind,
    label: page.fallbackLabel,
    lines: page.events.flatMap((event) => event.narration_parts.map((part) => [part.speaker.kind, part.text])),
  }));
}

/** A turn's saved event, as `game-get` returns it: the player's own line first. */
function savedTurn(sequence: number, eventType: string, input: string, text: string, payload: Record<string, unknown>): NarrationEvent {
  return createNarrationEvent({
    sequence,
    event_type: eventType,
    payload: { ...payload, input },
    narration_parts: [
      { text: input, speaker: INVESTIGATOR_SPEAKER },
      { text, speaker: NARRATOR_SPEAKER },
    ],
  });
}

/** A line that cost no turn, as `game-get` returns it. */
function savedLine(sequence: number, input: string, answer: string): NarrationEvent {
  return createNarrationEvent({
    sequence,
    event_type: NO_TURN_EVENT_TYPE,
    payload: { input, answered: answer === HELP ? 'help' : 'refused' },
    narration_parts: [
      { text: input, speaker: INVESTIGATOR_SPEAKER },
      { text: answer, speaker: SYSTEM_SPEAKER },
    ],
  });
}

function opened(events: NarrationEvent[]) {
  getMock.mockResolvedValueOnce({
    error: null,
    data: createGameGetResponse({ state: createGameState({ location: 'loc-garden' }), narration_events: events }),
  });
}

describe('resuming a game that holds lines which cost no turn', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    getMock.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows the same lines on the same pages as the live game did', async () => {
    const live = new GameSessionStore();
    opened([START, ARRIVAL]);
    await live.resumeSession('game-1');

    const say = async (input: string, response: unknown) => {
      invokeMock.mockResolvedValueOnce({ data: response, error: null });
      await live.submitInput(input);
    };
    await say('dance', createTurnRefusedResponse({ hint: HINT }));
    await say('help', createTurnViewResponse({ view: 'help', note: HELP }));
    await say(
      'go to the garden',
      createTurnPlayedResponse({
        events: [{ sequence: 5, event_type: 'move', payload: { location_name: 'Garden', input: 'go to the garden' }, narration_parts: [{ text: 'The garden.', speaker: NARRATOR_SPEAKER }] }],
        state: { mode: 'explore', time_remaining: 9, location: 'loc-garden', current_talk_character: null },
      }),
    );
    await say('help', createTurnViewResponse({ view: 'help', note: HELP }));
    await say('go', createTurnRefusedResponse({ reason: 'missing-target', hint: 'Where to? Try: Kitchen.' }));

    const resumed = new GameSessionStore();
    opened([
      START,
      ARRIVAL,
      savedLine(3, 'dance', HINT),
      savedLine(4, 'help', HELP),
      savedTurn(5, 'move', 'go to the garden', 'The garden.', { location_name: 'Garden' }),
      savedLine(6, 'help', HELP),
      savedLine(7, 'go', 'Where to? Try: Kitchen.'),
    ]);
    await resumed.resumeSession('game-1');

    expect(shown(resumed)).toEqual(shown(live));
    expect(resumed.pageCount).toBe(live.pageCount);
    // The lines do not open a page of their own: the kitchen holds the first two, the garden the rest.
    expect(shown(resumed).map((page) => page.label)).toEqual(['The case', 'Kitchen', 'Garden']);
    expect(shown(resumed)[1].lines.slice(-4)).toEqual([
      ['investigator', 'dance'],
      ['system', HINT],
      ['investigator', 'help'],
      ['system', HELP],
    ]);
  });

  it('does not take them for a page to open, nor the opening page for a case in progress', async () => {
    const store = new GameSessionStore();
    opened([START, savedLine(2, 'help', HELP)]);

    await store.resumeSession('game-1');

    expect(store.pageCount).toBe(1);
    expect(store.awaitingOpeningConfirmation).toBe(true);
  });
});
