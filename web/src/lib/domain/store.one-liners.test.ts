// The menu draws the titles at once, then fills in each case's line, narrated
// at the profile's age by a second request. A failure leaves the titles alone.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('../api/client', () => ({
  callApi: invokeMock,
  callApiGet: vi.fn(),
  blueprintImageUrl: (blueprintId: string, imageId: string) => `/api/images/${blueprintId}/${imageId}`,
}));

import { GameSessionStore } from './store.svelte';
import { createBlueprintSummary, createBlueprintsListResponse } from '../../../../tests/testkit/src/fixtures';

const FIRST = createBlueprintSummary({ id: '00000000-0000-0000-0000-00000000000a', title: 'The Stolen Cake', one_liner: null });
const SECOND = createBlueprintSummary({ id: '00000000-0000-0000-0000-00000000000b', title: 'The Stopped Clock', one_liner: null });

const titles = () => ({ error: null, data: createBlueprintsListResponse([FIRST, SECOND]) });
const lines = (first: string | null, second: string | null) => ({
  error: null,
  data: createBlueprintsListResponse([{ ...FIRST, one_liner: first }, { ...SECOND, one_liner: second }]),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the menu one-liners', () => {
  it('shows the titles before the lines, then fills the lines in', async () => {
    const store = new GameSessionStore();
    const narrated = deferred<ReturnType<typeof lines>>();
    invokeMock.mockResolvedValueOnce(titles()).mockReturnValueOnce(narrated.promise);

    const loading = store.loadBlueprints();
    await vi.waitFor(() => expect(store.oneLinerStatus).toBe('loading'));

    expect(store.status).toBe('idle');
    expect(store.blueprints.map((entry) => [entry.title, entry.one_liner])).toEqual([
      ['The Stolen Cake', null],
      ['The Stopped Clock', null],
    ]);
    expect(invokeMock.mock.calls).toEqual([['blueprints-list'], ['blueprints-list', { one_liners: true }]]);

    narrated.resolve(lines('Who took the cake?', 'Why did the clock stop?'));
    await loading;

    expect(store.oneLinerStatus).toBe('ready');
    expect(store.blueprints.map((entry) => entry.one_liner)).toEqual(['Who took the cake?', 'Why did the clock stop?']);
  });

  it('keeps the titles alone when the lines cannot be had', async () => {
    const store = new GameSessionStore();
    invokeMock.mockResolvedValueOnce(titles()).mockResolvedValueOnce({ error: { message: 'Choose a reading age', status: 400 }, data: null });

    await store.loadBlueprints();

    expect(store.oneLinerStatus).toBe('failed');
    expect(store.status).toBe('idle');
    expect(store.error).toBeNull();
    expect(store.blueprints.map((entry) => [entry.title, entry.one_liner])).toEqual([
      ['The Stolen Cake', null],
      ['The Stopped Clock', null],
    ]);
  });

  it('shows no line for a case the narration left out', async () => {
    const store = new GameSessionStore();
    invokeMock.mockResolvedValueOnce(titles()).mockResolvedValueOnce(lines(null, null));

    await store.loadBlueprints();

    expect(store.oneLinerStatus).toBe('ready');
    expect(store.blueprints.map((entry) => entry.one_liner)).toEqual([null, null]);
  });

  it('lets only the newest request write its lines', async () => {
    const store = new GameSessionStore();
    const slow = deferred<ReturnType<typeof lines>>();
    store.blueprints = [FIRST, SECOND];
    invokeMock.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(lines('New line.', 'Another.'));

    const older = store.loadOneLiners();
    await store.loadOneLiners();
    slow.resolve(lines('Old line.', 'Old too.'));
    await older;

    expect(store.blueprints.map((entry) => entry.one_liner)).toEqual(['New line.', 'Another.']);
    expect(store.oneLinerStatus).toBe('ready');
  });
});
