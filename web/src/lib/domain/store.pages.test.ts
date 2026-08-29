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
import { NARRATOR_SPEAKER } from '../../../../tests/testkit/src/fixtures';
import type { NarrationEvent } from '../types/game';

function narrationEvent(
  sequence: number,
  event_type: string,
  text: string,
  image_id: string | null = null,
  payload?: Record<string, unknown>,
): NarrationEvent {
  return {
    sequence,
    event_type,
    narration_parts: [{ text, speaker: NARRATOR_SPEAKER, image_id }],
    payload,
  };
}

function createStore(history: NarrationEvent[]) {
  const store = new GameSessionStore();
  store.game_id = 'game-1';
  store.blueprint_id = 'bp-1';
  store.blueprints = [
    { id: 'bp-1', title: 'The Missing Cake', one_liner: '', target_age: 10 },
  ];
  store.state = {
    mystery_summary: null,
    premise: null,
    locations: [{ id: 'kitchen', name: 'Kitchen' }, { id: 'garden', name: 'Garden' }],
    characters: [],
    discovered_clues: [],
    time_remaining: 10,
    location: 'Kitchen',
    mode: 'explore',
    current_talk_character: null,
    history,
  };
  store.status = 'active';
  return store;
}

const OPENING = narrationEvent(1, 'start', 'A cake has gone missing.', 'cover.png');
const ARRIVAL = narrationEvent(2, 'move', 'You step into the kitchen.', 'kitchen.png', {
  location_name: 'Kitchen',
});
const GARDEN = narrationEvent(3, 'move', 'You step into the garden.', 'garden.png', {
  location_name: 'Garden',
});

describe('page navigation', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('follows the newest page until the player navigates', () => {
    const store = createStore([OPENING, ARRIVAL, GARDEN]);

    expect(store.pageCount).toBe(3);
    expect(store.activePageIndex).toBeNull();
    expect(store.activePage?.fallbackLabel).toBe('Garden');
    expect(store.isOnLivePage).toBe(true);
  });

  it('steps backwards and forwards, clamping at both ends', () => {
    const store = createStore([OPENING, ARRIVAL, GARDEN]);

    store.prevPage();
    expect(store.activePage?.fallbackLabel).toBe('Kitchen');
    expect(store.isOnLivePage).toBe(false);

    store.prevPage();
    expect(store.activePage?.kind).toBe('opening');

    store.prevPage();
    expect(store.activePage?.kind).toBe('opening');

    store.nextPage();
    store.nextPage();
    expect(store.activePage?.fallbackLabel).toBe('Garden');
    // Reaching the newest page resumes following it.
    expect(store.activePageIndex).toBeNull();
    expect(store.isOnLivePage).toBe(true);

    store.nextPage();
    expect(store.activePage?.fallbackLabel).toBe('Garden');
  });

  it('returns to the live page on demand', () => {
    const store = createStore([OPENING, ARRIVAL, GARDEN]);

    store.goToPage(0);
    expect(store.isOnLivePage).toBe(false);

    store.goToLivePage();
    expect(store.activePageIndex).toBeNull();
    expect(store.isOnLivePage).toBe(true);
  });

  it('shows a newly arrived page while the player was reading an old one', () => {
    const store = createStore([OPENING, ARRIVAL]);
    store.goToPage(0);
    expect(store.isOnLivePage).toBe(false);

    // A page arriving while the player browses history must not yank them
    // forward -- only their own next command does that.
    store.state!.history.push(GARDEN);
    expect(store.pageCount).toBe(3);
    expect(store.activePage?.kind).toBe('opening');
  });

  it('snaps forward to the live page when the player submits a command', async () => {
    const store = createStore([OPENING, ARRIVAL, GARDEN]);
    store.goToPage(0);

    await store.submitInput('notebook');

    expect(store.activePageIndex).toBeNull();
    expect(store.isOnLivePage).toBe(true);
  });

  it('has no pages without a session', () => {
    const store = new GameSessionStore();
    expect(store.pages).toEqual([]);
    expect(store.activePage).toBeNull();
    expect(store.awaitingOpeningConfirmation).toBe(false);
  });
});

describe('opening confirmation', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('waits while the opening is the only page', () => {
    const store = createStore([OPENING]);
    expect(store.awaitingOpeningConfirmation).toBe(true);
  });

  it('stops waiting once the arrival page exists', () => {
    const store = createStore([OPENING, ARRIVAL]);
    expect(store.awaitingOpeningConfirmation).toBe(false);
  });

  it('never waits when reviewing a completed case', () => {
    const store = createStore([OPENING]);
    store.viewerMode = 'read_only_completed';
    expect(store.awaitingOpeningConfirmation).toBe(false);
  });

  it('calls game-enter and appends the arrival as a move event', async () => {
    const store = createStore([OPENING]);
    invokeMock.mockResolvedValue({
      data: {
        narration_parts: [
          { text: 'You step into the kitchen.', speaker: NARRATOR_SPEAKER, image_id: 'kitchen.png' },
        ],
        current_location: 'kitchen',
        time_remaining: 10,
        mode: 'explore',
      },
      error: null,
    });

    await store.enterStartingLocation();

    expect(invokeMock).toHaveBeenCalledWith('game-enter', { game_id: 'game-1' });
    expect(store.pageCount).toBe(2);
    expect(store.pages[1].kind).toBe('location');
    expect(store.pages[1].imageId).toBe('kitchen.png');
    expect(store.awaitingOpeningConfirmation).toBe(false);
    // Entering the starting location is free.
    expect(store.state?.time_remaining).toBe(10);
  });

  it('does not call game-enter once the arrival exists', async () => {
    const store = createStore([OPENING, ARRIVAL]);

    await store.enterStartingLocation();

    expect(invokeMock).not.toHaveBeenCalled();
  });
});
