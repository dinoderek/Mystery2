import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('../api/client', () => ({
  callApi: invokeMock,
  callApiGet: vi.fn(),
  blueprintImageUrl: (blueprintId: string, imageId: string) =>
    `/api/images/${blueprintId}/${imageId}`,
}));

import { GameSessionStore } from './store.svelte';
import {
  CHARACTERS,
  LOCATIONS,
  NARRATOR_SPEAKER,
  characterSpeaker,
  createRevealedClue,
  createTurnPlayedResponse,
  createTurnQuitResponse,
  createTurnRefusedResponse,
} from '../../../../tests/testkit/src/fixtures';
import type { NarrationEvent } from '../types/game';

function createStore(mode: 'explore' | 'talk' | 'accuse' = 'explore') {
  const store = new GameSessionStore();
  store.game_id = 'game-1';
  store.blueprint_id = 'bp-1';
  store.state = {
    mystery_summary: null,
    premise: null,
    locations: LOCATIONS.map((location) => ({ id: location.id, name: location.name })),
    characters: CHARACTERS.map((character) => ({
      id: character.id,
      first_name: character.first_name,
      last_name: character.last_name,
      location_name: character.location_id,
      sex: character.sex,
    })),
    discovered_clues: [],
    time_remaining: 10,
    location: 'loc-kitchen',
    mode,
    current_talk_character: null,
    history: [
      { sequence: 1, event_type: 'start', narration_parts: [{ text: 'Case begins.', speaker: NARRATOR_SPEAKER }] },
      { sequence: 2, event_type: 'move', narration_parts: [{ text: 'The kitchen.', speaker: NARRATOR_SPEAKER }], payload: { location_name: 'Kitchen' } },
    ],
  };
  store.status = 'active';
  return store;
}

function answer(data: unknown) {
  invokeMock.mockResolvedValueOnce({ data, error: null });
}

function event(event_type: string, text: string, payload?: Record<string, unknown>) {
  return { sequence: 3, event_type, payload, narration_parts: [{ text, speaker: NARRATOR_SPEAKER }] };
}

function typesOf(events: NarrationEvent[] | undefined): string[] {
  return (events ?? []).map((entry) => entry.event_type);
}

describe('playing a line', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it.each([
    'go to the garden',
    'move Garden',
    'search',
    'search the sideboard',
    'talk to Rosie',
    'ask where were you',
    'end talk',
    'accuse Bob, he had the cake',
    'accuse',
    'dance wildly',
    'GO',
    '  search  ',
  ])('sends %j to game-turn exactly as typed', async (line) => {
    const store = createStore();
    answer(createTurnPlayedResponse());

    await store.submitInput(line);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('game-turn', { game_id: 'game-1', input: line });
  });

  it('shows the player their line, then what the game saved, naming the page from the saved payload', async () => {
    const store = createStore();
    answer(
      createTurnPlayedResponse({
        events: [event('move', 'You reach the garden.', { location_id: 'loc-garden', location_name: 'Garden', input: 'go to the garden' })],
        state: { mode: 'explore', time_remaining: 9, location: 'loc-garden', current_talk_character: null },
      }),
    );

    await store.submitInput('go to the garden');

    expect(typesOf(store.state?.history)).toEqual(['start', 'move', 'input', 'move']);
    expect(store.state).toMatchObject({ mode: 'explore', time_remaining: 9, location: 'loc-garden' });
    // The echo is carried onto the page it caused, and the page is named by the saved payload.
    expect(store.pageCount).toBe(3);
    expect(store.activePage?.fallbackLabel).toBe('Garden');
    expect(store.activePage?.events.map((entry) => entry.event_type)).toEqual(['input', 'move']);
  });

  it('echoes the line while the narrator is still answering', async () => {
    const store = createStore();
    let release!: (value: unknown) => void;
    invokeMock.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));

    const pending = store.submitInput('search');

    expect(store.status).toBe('loading');
    expect(typesOf(store.state?.history)).toEqual(['start', 'move', 'input']);

    release({ data: createTurnPlayedResponse(), error: null });
    await pending;
    expect(store.status).toBe('active');
  });

  it('follows the talk state and keeps the conversation on one page', async () => {
    const store = createStore();
    answer(
      createTurnPlayedResponse({
        events: [{ ...event('talk', 'Rosie looks up.', { character_name: 'Rosie' }), narration_parts: [{ text: 'Rosie looks up.', speaker: characterSpeaker('Rosie') }] }],
        state: { mode: 'talk', time_remaining: 9, location: 'loc-kitchen', current_talk_character: 'char-rosie' },
      }),
    );
    await store.submitInput('talk to Rosie');
    answer(createTurnPlayedResponse({ events: [event('ask', 'She shrugs.')], state: { mode: 'talk', time_remaining: 8, location: 'loc-kitchen', current_talk_character: 'char-rosie' } }));
    await store.submitInput('ask about the cake');

    expect(store.state).toMatchObject({ mode: 'talk', time_remaining: 8, current_talk_character: 'char-rosie' });
    expect(store.activePage).toMatchObject({ kind: 'conversation', fallbackLabel: 'Rosie' });
    expect(store.activePage?.events.map((entry) => entry.event_type)).toEqual(['input', 'talk', 'input', 'ask']);
  });

  it('adds every event of a turn that ran out the clock, and opens the accusation', async () => {
    const store = createStore();
    answer(
      createTurnPlayedResponse({
        events: [event('search', 'You find nothing.'), event('forced_endgame', 'Time is up. Name the culprit.')],
        state: { mode: 'accuse', time_remaining: 0, location: 'loc-kitchen', current_talk_character: null },
      }),
    );

    await store.submitInput('search');

    expect(typesOf(store.state?.history).slice(-3)).toEqual(['input', 'search', 'forced_endgame']);
    expect(store.state).toMatchObject({ mode: 'accuse', time_remaining: 0 });
    expect(store.viewerMode).toBe('interactive');
  });

  it('opens the accusation page for an accusation given with its reasoning', async () => {
    const store = createStore('explore');
    answer(
      createTurnPlayedResponse({
        events: [event('accuse_round', 'Go on.')],
        state: { mode: 'accuse', time_remaining: 9, location: 'loc-kitchen', current_talk_character: null },
      }),
    );

    await store.submitInput('accuse Bob, he had the cake');

    expect(store.activePage).toMatchObject({ kind: 'accusation', fallbackLabel: 'The accusation' });
  });

  it('keeps an accusation round on the accusation page once it is open', async () => {
    const store = createStore('accuse');
    store.state!.history.push({ sequence: 3, event_type: 'accuse_start', narration_parts: [{ text: 'Who?', speaker: NARRATOR_SPEAKER }] });
    answer(
      createTurnPlayedResponse({
        events: [event('accuse_round', 'Go on.')],
        state: { mode: 'accuse', time_remaining: 0, location: 'loc-kitchen', current_talk_character: null },
      }),
    );

    await store.submitInput('because of the crumbs');

    expect(store.pageCount).toBe(3);
    expect(store.activePage?.kind).toBe('accusation');
    expect(typesOf(store.state?.history).slice(-2)).toEqual(['input', 'accuse_round']);
  });

  it('ends the case with a verdict', async () => {
    const store = createStore('accuse');
    answer(
      createTurnPlayedResponse({
        events: [event('accuse_resolved', 'You are right.')],
        state: { mode: 'ended', time_remaining: 0, location: 'loc-kitchen', current_talk_character: null },
        result: 'win',
      }),
    );

    await store.submitInput('because of the crumbs');

    expect(store.state?.mode).toBe('ended');
    expect(store.accusationOutcome).toBe('win');
    expect(store.awaitingReturnToList).toBe(true);
    expect(store.viewerMode).toBe('read_only_completed');
  });

  it('adds clues found by the turn to the notebook once', async () => {
    const store = createStore();
    const crumbs = createRevealedClue();
    answer(createTurnPlayedResponse({ revealed_clues: [crumbs] }));
    answer(createTurnPlayedResponse({ revealed_clues: [crumbs, createRevealedClue({ id: 'clue-cup', text: 'A cup.' })] }));

    await store.submitInput('search');
    await store.submitInput('search');

    expect(store.state?.discovered_clues.map((clue) => clue.id)).toEqual(['clue-crumbs', 'clue-cup']);
    expect(store.recentlyDiscovered.map((clue) => clue.id)).toEqual(['clue-cup']);
  });

  it('shows the hint for a refused line and changes nothing else', async () => {
    const store = createStore();
    answer(createTurnRefusedResponse({ hint: 'Where to? Try: Garden.' }));

    await store.submitInput('go');

    expect(typesOf(store.state?.history)).toEqual(['start', 'move', 'input', 'system_response']);
    expect(store.state?.history.at(-1)?.narration_parts[0].text).toBe('Where to? Try: Garden.');
    expect(store.state).toMatchObject({ mode: 'explore', time_remaining: 10 });
  });

  it('leaves the case on quit, as it always has', async () => {
    const store = createStore();
    answer(createTurnQuitResponse());

    await store.submitInput('quit');

    expect(store.state?.mode).toBe('ended');
    expect(store.awaitingReturnToList).toBe(true);
    expect(store.accusationOutcome).toBeNull();
    expect(store.state?.history.at(-1)?.narration_parts[0].text).toContain('This case is over.');
  });

  it('does not send a line while a turn is running or the case is over', async () => {
    const store = createStore();
    store.status = 'loading';
    await store.submitInput('search');
    store.status = 'active';
    store.awaitingReturnToList = true;
    await store.submitInput('search');

    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('a turn that fails', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows a 409 like any other failed turn, and offers the same line again', async () => {
    const store = createStore();
    invokeMock.mockResolvedValueOnce({ data: null, error: { message: 'Another turn was saved first', status: 409 } });

    await store.submitInput('search');

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(store.error).toBe('Another turn was saved first');
    expect(store.lastFailedInput).toBe('search');
    expect(store.status).toBe('active');
    expect(store.state?.history.at(-1)?.narration_parts[0].text).toBe('Request failed: Another turn was saved first');

    answer(createTurnPlayedResponse());
    await store.retryLastCommand();

    expect(invokeMock).toHaveBeenLastCalledWith('game-turn', { game_id: 'game-1', input: 'search' });
    expect(store.error).toBeNull();
    expect(store.lastFailedInput).toBeNull();
  });

  it('retries a transient failure, then plays the turn', async () => {
    vi.useFakeTimers();
    try {
      const store = createStore();
      invokeMock.mockResolvedValueOnce({ data: null, error: { message: 'Bad gateway', status: 502 } });
      answer(createTurnPlayedResponse());

      const pending = store.submitInput('search');
      await vi.runAllTimersAsync();
      await pending;

      expect(invokeMock).toHaveBeenCalledTimes(2);
      expect(store.state?.history.some((entry) => entry.narration_parts[0].text.includes('Trying again (1/3)'))).toBe(true);
      expect(store.isRetrying).toBe(false);
      expect(store.state?.time_remaining).toBe(9);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after three tries and says so', async () => {
    vi.useFakeTimers();
    try {
      const store = createStore();
      invokeMock.mockResolvedValue({ data: null, error: { message: 'Bad gateway', status: 502 } });

      const pending = store.submitInput('search');
      await vi.runAllTimersAsync();
      await pending;

      expect(invokeMock).toHaveBeenCalledTimes(3);
      expect(store.lastFailedInput).toBe('search');
      expect(store.state?.history.at(-1)?.narration_parts[0].text).toContain('even after 3 tries');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an answer that fails the schema, surfaces it, and does not offer a retry', async () => {
    const store = createStore();
    answer({ kind: 'turn', events: [], state: { mode: 'explore' } });

    await store.submitInput('search');

    expect(store.error).toContain('game-turn');
    expect(store.error).toContain('events');
    expect(store.lastFailedInput).toBeNull();
    expect(store.state).toMatchObject({ mode: 'explore', time_remaining: 10 });
    expect(typesOf(store.state?.history)).toEqual(['start', 'move', 'input', 'error']);
    expect(store.state?.history.at(-1)?.narration_parts[0].text).toContain('reopen the case');
    // Logged, not swallowed.
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('game-turn'), expect.any(Array));
    expect(store.status).toBe('active');
  });

  it('rejects an answer of an unknown kind', async () => {
    const store = createStore();
    answer({ kind: 'dance' });

    await store.submitInput('search');

    expect(store.error).toContain('kind');
    expect(store.state?.time_remaining).toBe(10);
  });
});
