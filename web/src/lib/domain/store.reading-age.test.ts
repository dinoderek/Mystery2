import { beforeEach, describe, expect, it, vi } from 'vitest';

const { postMock, getMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  getMock: vi.fn(),
}));

vi.mock('../api/client', () => ({
  callApi: postMock,
  callApiGet: getMock,
  blueprintImageUrl: (blueprintId: string, imageId: string) => `/api/images/${blueprintId}/${imageId}`,
}));

import { GameSessionStore } from './store.svelte';
import {
  createGameEnterResponse,
  createGameGetResponse,
  createGameStartResponse,
  createProfileSettings,
  createTurnPlayedResponse,
} from '../../../../tests/testkit/src/fixtures';

// A profile with no reading age (a local database from before) is refused a game
// with READING_AGE_REQUIRED. The store asks for an age, and carries on once chosen.

const REQUIRED = {
  data: { error: 'Choose a reading age before playing', details: { code: 'READING_AGE_REQUIRED' } },
  error: { message: 'Choose a reading age before playing', status: 400, code: 'READING_AGE_REQUIRED' },
};
const ok = (data: unknown) => ({ data, error: null });

beforeEach(() => {
  postMock.mockReset();
  getMock.mockReset();
});

describe('a game refused for want of a reading age', () => {
  it('asks for an age instead of failing, then starts the game once one is chosen', async () => {
    const store = new GameSessionStore();
    postMock.mockResolvedValueOnce(REQUIRED);

    await store.startGame('bp-1');

    expect(store.needsReadingAge).toBe(true);
    expect(store.status).toBe('idle');
    expect(store.error).toBeNull();
    expect(store.game_id).toBeNull();

    postMock.mockResolvedValueOnce(ok(createProfileSettings({ reading_age: 9 })));
    postMock.mockResolvedValueOnce(ok(createGameStartResponse({ game_id: '00000000-0000-0000-0000-0000000000aa' })));
    expect(await store.chooseReadingAge(9)).toBe(true);

    expect(postMock).toHaveBeenNthCalledWith(2, 'profile-settings', { reading_age: 9 });
    expect(postMock).toHaveBeenNthCalledWith(3, 'game-start', { blueprint_id: 'bp-1' });
    expect(store.needsReadingAge).toBe(false);
    expect(store.status).toBe('active');
    expect(store.game_id).toBe('00000000-0000-0000-0000-0000000000aa');
  });

  it('keeps asking when the age is not accepted, and carries nothing on', async () => {
    const store = new GameSessionStore();
    postMock.mockResolvedValueOnce(REQUIRED);
    await store.startGame('bp-1');

    postMock.mockResolvedValueOnce({ data: null, error: { message: 'Invalid reading_age', status: 400 } });
    expect(await store.chooseReadingAge(9)).toBe(false);

    expect(store.needsReadingAge).toBe(true);
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it('reopens a game once an age is chosen', async () => {
    const store = new GameSessionStore();
    getMock.mockResolvedValueOnce(REQUIRED);

    await store.resumeSession('game-9');
    expect(store.needsReadingAge).toBe(true);
    expect(store.status).toBe('idle');

    postMock.mockResolvedValueOnce(ok(createProfileSettings({ reading_age: 7 })));
    getMock.mockResolvedValueOnce(ok(createGameGetResponse()));
    await store.chooseReadingAge(7);

    expect(getMock).toHaveBeenLastCalledWith('game-get', { game_id: 'game-9' });
    expect(store.game_id).toBe('game-9');
    expect(store.status).toBe('active');
  });

  async function openGame(): Promise<GameSessionStore> {
    const store = new GameSessionStore();
    postMock.mockResolvedValueOnce(ok(createGameStartResponse()));
    await store.startGame('bp-1');
    postMock.mockClear();
    return store;
  }

  it('asks before a typed line is played, takes the line back, and plays it once an age is chosen', async () => {
    const store = await openGame();
    const linesBefore = store.state!.history.length;
    postMock.mockResolvedValueOnce(REQUIRED);

    await store.submitInput('search');

    expect(store.needsReadingAge).toBe(true);
    expect(store.state!.history).toHaveLength(linesBefore);
    expect(store.lastFailedInput).toBeNull();

    postMock.mockResolvedValueOnce(ok(createProfileSettings({ reading_age: 6 })));
    postMock.mockResolvedValueOnce(ok(createTurnPlayedResponse()));
    await store.chooseReadingAge(6);

    expect(postMock).toHaveBeenLastCalledWith('game-turn', { game_id: store.game_id, input: 'search' });
    expect(store.needsReadingAge).toBe(false);
  });

  it('asks before the arrival is narrated, and narrates it once an age is chosen', async () => {
    const store = await openGame();
    postMock.mockResolvedValueOnce(REQUIRED);

    await store.enterStartingLocation();
    expect(store.needsReadingAge).toBe(true);

    postMock.mockResolvedValueOnce(ok(createProfileSettings({ reading_age: 10 })));
    postMock.mockResolvedValueOnce(ok(createGameEnterResponse()));
    await store.chooseReadingAge(10);

    expect(postMock).toHaveBeenLastCalledWith('game-enter', { game_id: store.game_id });
    expect(store.state!.history.some((line) => line.event_type === 'move')).toBe(true);
  });

  it('forgets the question when the player leaves for the mystery list', async () => {
    const store = new GameSessionStore();
    postMock.mockResolvedValueOnce(REQUIRED);
    await store.startGame('bp-1');

    store.clearSessionForMysteryList();

    expect(store.needsReadingAge).toBe(false);
  });
});
