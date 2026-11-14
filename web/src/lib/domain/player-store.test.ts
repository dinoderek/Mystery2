import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlayerStore } from './player-store.svelte';

const fetchMock = vi.fn();

function reply(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

function newStore(): PlayerStore {
  vi.stubGlobal('fetch', fetchMock);
  return new PlayerStore();
}

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const ANN = { id: 'p1', name: 'Ann' };
const BOB = { id: 'p2', name: 'Bob' };

describe('PlayerStore.init', () => {
  it('loads the signed-in profile and the profiles to choose from', async () => {
    const store = newStore();
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/player' ? reply({ player: ANN }) : reply({ players: [ANN, BOB] }),
    );

    await store.init();

    expect(store.player).toEqual(ANN);
    expect(store.profiles).toEqual([ANN, BOB]);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('reads a failed lookup as nobody signed in and no profiles', async () => {
    const store = newStore();
    fetchMock.mockResolvedValue(reply({ error: 'no' }, 500));

    await store.init();

    expect(store.player).toBeNull();
    expect(store.profiles).toEqual([]);
    expect(store.loading).toBe(false);
  });

  it('reads a response with no player as signed out', async () => {
    const store = newStore();
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/player' ? reply({ player: null }) : reply({}),
    );

    await store.init();

    expect(store.player).toBeNull();
    expect(store.profiles).toEqual([]);
  });

  it('records the reason when the server cannot be reached, and stops loading', async () => {
    const store = newStore();
    fetchMock.mockRejectedValue(new Error('offline'));

    await store.init();

    expect(store.error).toBe('offline');
    expect(store.loading).toBe(false);
  });

  it('records a thrown value that is not an Error as text', async () => {
    const store = newStore();
    fetchMock.mockRejectedValue('boom');

    await store.init();

    expect(store.error).toBe('boom');
  });
});

describe('PlayerStore.signIn', () => {
  it('refuses a blank name without calling the server', async () => {
    const store = newStore();

    expect(await store.signIn('   ')).toBe(false);

    expect(store.error).toBe('Enter a name');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the trimmed name, signs in and adds a new profile to the list', async () => {
    const store = newStore();
    store.profiles = [ANN];
    fetchMock.mockResolvedValue(reply({ player: BOB }));

    expect(await store.signIn('  Bob ')).toBe(true);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: 'Bob' });
    expect(store.player).toEqual(BOB);
    expect(store.profiles).toEqual([ANN, BOB]);
    expect(store.error).toBeNull();
  });

  it('does not list a profile twice when it already exists', async () => {
    const store = newStore();
    store.profiles = [ANN];
    fetchMock.mockResolvedValue(reply({ player: ANN }));

    await store.signIn('Ann');

    expect(store.profiles).toEqual([ANN]);
  });

  it("shows the server's reason when it refuses the name", async () => {
    const store = newStore();
    fetchMock.mockResolvedValue(reply({ error: 'Name too long' }, 400));

    expect(await store.signIn('x')).toBe(false);

    expect(store.error).toBe('Name too long');
    expect(store.player).toBeNull();
  });

  it('falls back to the status when the refusal has no reason', async () => {
    const store = newStore();
    fetchMock.mockResolvedValue(reply('not json', 500));

    expect(await store.signIn('x')).toBe(false);

    expect(store.error).toBe('Could not sign in (500)');
  });

  it('treats an accepted response with no player as a failure', async () => {
    const store = newStore();
    fetchMock.mockResolvedValue(reply({ player: null }));

    expect(await store.signIn('x')).toBe(false);

    expect(store.player).toBeNull();
    expect(store.error).toBe('Could not sign in (200)');
  });

  it('reports a network failure and stays signed out', async () => {
    const store = newStore();
    fetchMock.mockRejectedValue(new Error('offline'));

    expect(await store.signIn('x')).toBe(false);

    expect(store.error).toBe('offline');
  });

  it('reports a thrown value that is not an Error as text', async () => {
    const store = newStore();
    fetchMock.mockRejectedValue('boom');

    await store.signIn('x');

    expect(store.error).toBe('boom');
  });
});

describe('PlayerStore.signOut', () => {
  it('asks the server to forget the profile and clears the player', async () => {
    const store = newStore();
    store.player = ANN;
    fetchMock.mockResolvedValue(reply({}));

    await store.signOut();

    expect(fetchMock).toHaveBeenCalledWith('/api/player', { method: 'DELETE' });
    expect(store.player).toBeNull();
  });

  it('stays signed in and says why when the server cannot be reached', async () => {
    const store = newStore();
    store.player = ANN;
    fetchMock.mockRejectedValue(new Error('offline'));

    await store.signOut();

    expect(store.player).toEqual(ANN);
    expect(store.error).toBe('offline');
  });

  it('reports a thrown value that is not an Error as text', async () => {
    const store = newStore();
    fetchMock.mockRejectedValue('boom');

    await store.signOut();

    expect(store.error).toBe('boom');
  });
});
