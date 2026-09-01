import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { normalizeSessionCatalog, normalizeSessionSummary, sortSessionSummaries } from './store.svelte';
import { GameSessionStore } from './store.svelte';
import type { SessionSummary } from '../types/game';
import type { ApiResult } from '../api/client';
import {
  NARRATOR_SPEAKER,
  characterSpeaker,
  createSessionSummary,
  createSessionCatalog,
  createNarrationEvent,
  createGameState,
} from '../../../../tests/testkit/src/fixtures';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

/** A response the test decides the timing of, so two can be raced deliberately. */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** A catalog payload whose only interesting property is its counts. */
function catalogWith(inProgress: number, completed: number) {
  const rows = (count: number, mode: 'explore' | 'ended') =>
    Array.from({ length: count }, (_, index) =>
      createSessionSummary({
        game_id: `00000000-0000-0000-0000-0000000${mode === 'ended' ? 'e' : 'a'}000${index}`,
        mode,
        time_remaining: mode === 'ended' ? 0 : 5,
        outcome: mode === 'ended' ? 'win' : null,
      }) as SessionSummary,
    );

  return createSessionCatalog({
    in_progress: rows(inProgress, 'explore'),
    completed: rows(completed, 'ended'),
    counts: { in_progress: inProgress, completed: completed },
  });
}

describe('session catalog helpers', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    getMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes session summaries and clamps defaults', () => {
    const normalized = normalizeSessionSummary({
      game_id: 'g-1',
      blueprint_id: 'bp-1',
      mystery_title: '',
      mystery_available: false,
      can_open: true,
      mode: 'ended',
      time_remaining: -4,
      outcome: 'invalid',
      last_played_at: 'not-a-date',
      created_at: '2026-03-10T12:00:00.000Z',
    });

    expect(normalized).toMatchObject({
      game_id: 'g-1',
      blueprint_id: 'bp-1',
      mystery_title: 'Unknown Mystery',
      mystery_available: false,
      can_open: false,
      mode: 'ended',
      time_remaining: 0,
      outcome: null,
    });
    expect(normalized?.last_played_at).toBe('1970-01-01T00:00:00.000Z');
  });

  it('sorts by recency with stable tie-breakers', () => {
    const UUID_A = '00000000-0000-0000-0000-00000000000a';
    const UUID_B = '00000000-0000-0000-0000-00000000000b';
    const UUID_C = '00000000-0000-0000-0000-00000000000c';

    // Zod-validated via createSessionSummary(); explicit annotation bridges
    // the shared and frontend SessionSummary types for svelte-check.
    const entries: SessionSummary[] = [
      createSessionSummary({
        game_id: UUID_A,
        mystery_title: 'A',
        last_played_at: '2026-03-10T12:00:00.000Z',
        created_at: '2026-03-08T12:00:00.000Z',
      }) as SessionSummary,
      createSessionSummary({
        game_id: UUID_C,
        mystery_title: 'C',
        last_played_at: '2026-03-10T12:00:00.000Z',
        created_at: '2026-03-08T12:00:00.000Z',
      }) as SessionSummary,
      createSessionSummary({
        game_id: UUID_B,
        mystery_title: 'B',
        last_played_at: '2026-03-11T12:00:00.000Z',
        created_at: '2026-03-07T12:00:00.000Z',
      }) as SessionSummary,
    ];
    const sorted = sortSessionSummaries(entries);

    expect(sorted.map((entry) => entry.game_id)).toEqual([UUID_B, UUID_C, UUID_A]);
  });

  it('normalizes grouped arrays and derives counts from mode', () => {
    const inProgress: SessionSummary[] = [
      createSessionSummary({ mystery_title: 'Mystery 1', time_remaining: 7 }) as SessionSummary,
    ];
    const completed: SessionSummary[] = [
      createSessionSummary({
        game_id: '00000000-0000-0000-0000-000000000003',
        blueprint_id: '00000000-0000-0000-0000-000000000004',
        mystery_title: 'Mystery 2',
        mode: 'ended',
        time_remaining: 0,
        outcome: 'win',
        last_played_at: '2026-03-11T12:00:00.000Z',
        created_at: '2026-03-08T12:00:00.000Z',
      }) as SessionSummary,
    ];
    const catalog = normalizeSessionCatalog({
      in_progress: inProgress,
      completed,
      counts: { in_progress: 999, completed: 999 },
    });

    expect(catalog.in_progress).toHaveLength(1);
    expect(catalog.completed).toHaveLength(1);
    expect(catalog.counts).toEqual({ in_progress: 1, completed: 1 });
  });

  it('hydrates resumed history only from persisted narration events', async () => {
    const store = new GameSessionStore();
    getMock.mockResolvedValue({
      error: null,
      data: {
        state: createGameState({
          locations: [{ id: 'loc-kitchen', name: 'Kitchen' }],
          characters: [],
          time_remaining: 3,
        }),
        narration_events: [
          createNarrationEvent({
            sequence: 1,
            event_type: 'move',
            narration_parts: [{ text: 'You enter the kitchen.', speaker: NARRATOR_SPEAKER }],
          }),
        ],
      },
    });

    await store.resumeSession('game-1');

    expect(store.status).toBe('active');
    expect(store.state?.history).toEqual([
      {
        sequence: 1,
        event_type: 'move',
        narration_parts: [
          { text: 'You enter the kitchen.', speaker: NARRATOR_SPEAKER, image_id: null },
        ],
      },
    ]);
  });

  it('preserves multi-part resumed transcripts without changing order', async () => {
    const store = new GameSessionStore();
    const aliceSpeaker = characterSpeaker('Alice');
    getMock.mockResolvedValue({
      error: null,
      data: {
        state: createGameState({
          locations: [{ id: 'loc-kitchen', name: 'Kitchen' }],
          characters: [{
            id: 'char-alice',
            first_name: 'Alice',
            last_name: 'Smith',
            location_id: 'loc-kitchen',
            location_name: 'Kitchen',
            sex: 'female' as const,
          }],
          time_remaining: 0,
          mode: 'ended',
        }),
        narration_events: [
          createNarrationEvent({
            sequence: 1,
            event_type: 'ask',
            narration_parts: [
              { text: 'Alice says she heard the clock strike nine.', speaker: aliceSpeaker, image_id: 'portrait-alice' },
              { text: 'The room falls silent as time runs out.', speaker: NARRATOR_SPEAKER },
            ],
          }),
          createNarrationEvent({
            sequence: 2,
            event_type: 'forced_endgame',
            narration_parts: [
              { text: 'You must make your accusation now.', speaker: NARRATOR_SPEAKER },
            ],
          }),
        ],
      },
    });

    await store.resumeSession('game-2');

    expect(store.status).toBe('active');
    expect(store.state?.mode).toBe('ended');
    expect(store.viewerMode).toBe('read_only_completed');
    expect(store.state?.history).toEqual([
      {
        sequence: 1,
        event_type: 'ask',
        narration_parts: [
          {
            text: 'Alice says she heard the clock strike nine.',
            speaker: aliceSpeaker,
            image_id: 'portrait-alice',
          },
          {
            text: 'The room falls silent as time runs out.',
            speaker: NARRATOR_SPEAKER,
            image_id: null,
          },
        ],
      },
      {
        sequence: 2,
        event_type: 'forced_endgame',
        narration_parts: [
          { text: 'You must make your accusation now.', speaker: NARRATOR_SPEAKER, image_id: null },
        ],
      },
    ]);
  });

  it('reissues a forced reload while an earlier request is still in flight', async () => {
    const store = new GameSessionStore();
    const first = deferred<ApiResult>();
    const second = deferred<ApiResult>();
    invokeMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    void store.loadSessionCatalog(true);
    void store.loadSessionCatalog(true);

    expect(invokeMock).toHaveBeenCalledTimes(2);

    second.resolve({ error: null, data: catalogWith(2, 1) });
    first.resolve({ error: null, data: catalogWith(9, 9) });
    await Promise.resolve();

    expect(store.sessionCatalogStatus).toBe('ready');
    expect(store.sessionCatalog.counts).toEqual({ in_progress: 2, completed: 1 });
  });

  it('does not let a failure that lost the race stick to the screen', async () => {
    // The landing-page regression: the first request went out signed-out and
    // came back 401 slowly, after signing in had already remounted the page and
    // asked again. Its error must not land on the answer that replaced it.
    const store = new GameSessionStore();
    const signedOut = deferred<ApiResult>();
    const signedIn = deferred<ApiResult>();
    invokeMock.mockReturnValueOnce(signedOut.promise).mockReturnValueOnce(signedIn.promise);

    void store.loadSessionCatalog(true);
    void store.loadSessionCatalog(true);

    signedIn.resolve({ error: null, data: catalogWith(1, 0) });
    await Promise.resolve();
    signedOut.resolve({ error: { message: 'Not signed in', status: 401 }, data: null });
    await Promise.resolve();

    expect(store.sessionCatalogStatus).toBe('ready');
    expect(store.sessionCatalogError).toBeNull();
    expect(store.sessionCatalog.counts).toEqual({ in_progress: 1, completed: 0 });
  });

  it('keeps the underlying cause when the catalog fails', async () => {
    const store = new GameSessionStore();
    invokeMock.mockResolvedValue({ error: { message: 'Not signed in', status: 401 }, data: null });

    await store.loadSessionCatalog(true);

    expect(store.sessionCatalogStatus).toBe('error');
    expect(store.sessionCatalogError).toBe('Not signed in');
    expect(store.sessionCatalog.counts).toEqual({ in_progress: 0, completed: 0 });
  });

  it('joins an in-flight request rather than reissuing when not forced', async () => {
    const store = new GameSessionStore();
    const pending = deferred<ApiResult>();
    invokeMock.mockReturnValueOnce(pending.promise);

    void store.loadSessionCatalog(true);
    void store.loadSessionCatalog();

    expect(invokeMock).toHaveBeenCalledTimes(1);

    pending.resolve({ error: null, data: catalogWith(0, 3) });
    await Promise.resolve();

    expect(store.sessionCatalogStatus).toBe('ready');
    expect(store.sessionCatalog.counts).toEqual({ in_progress: 0, completed: 3 });
  });

  it('surfaces transcript recovery guidance when resume fails', async () => {
    const store = new GameSessionStore();
    getMock.mockResolvedValue({
      error: { message: 'Failed to load transcript', status: 500 },
      data: {
        error: 'Failed to load transcript',
        details: {
          recovery: 'Return to the mystery list and reopen the case.',
        },
      },
    });

    await store.resumeSession('game-1');

    expect(store.status).toBe('idle');
    expect(store.error).toBe(
      'Failed to load transcript. Return to the mystery list and reopen the case.',
    );
  });
});

describe('mystery title from blueprint lookup', () => {
  /**
   * Mirrors the derived logic in Header.svelte:
   *   blueprint_id → blueprints.find() → title
   */
  function getMysteryTitle(store: GameSessionStore): string {
    const blueprintId = store.blueprint_id;
    if (!blueprintId) return 'Unknown Mystery';
    const blueprint = store.blueprints.find((b) => b.id === blueprintId);
    return blueprint?.title || 'Unknown Mystery';
  }

  it('resolves title from blueprints even when session catalog is empty', () => {
    const store = new GameSessionStore();
    store.blueprint_id = 'bp-1';
    store.blueprints = [
      { id: 'bp-1', title: 'The Haunted Manor', one_liner: '', target_age: 12, blueprint_image_id: null },
    ];
    // Session catalog has no rows — this was the original bug scenario
    expect(store.sessionCatalog.in_progress).toHaveLength(0);
    expect(store.sessionCatalog.completed).toHaveLength(0);
    expect(getMysteryTitle(store)).toBe('The Haunted Manor');
  });

  it('resolves title for a newly started game before catalog refresh', () => {
    const store = new GameSessionStore();
    store.game_id = 'game-new';
    store.blueprint_id = 'bp-2';
    store.blueprints = [
      { id: 'bp-1', title: 'The Haunted Manor', one_liner: '', target_age: 12, blueprint_image_id: null },
      { id: 'bp-2', title: 'Murder at Midnight', one_liner: '', target_age: 14, blueprint_image_id: null },
    ];
    // game-new doesn't exist in the catalog yet (startGame doesn't refresh it)
    expect(getMysteryTitle(store)).toBe('Murder at Midnight');
  });

  it('returns fallback when no blueprint_id is set', () => {
    const store = new GameSessionStore();
    expect(getMysteryTitle(store)).toBe('Unknown Mystery');
  });

  it('returns fallback when blueprint_id does not match any loaded blueprint', () => {
    const store = new GameSessionStore();
    store.blueprint_id = 'bp-missing';
    store.blueprints = [
      { id: 'bp-1', title: 'The Haunted Manor', one_liner: '', target_age: 12, blueprint_image_id: null },
    ];
    expect(getMysteryTitle(store)).toBe('Unknown Mystery');
  });

  it('returns fallback when matching blueprint has an empty title', () => {
    const store = new GameSessionStore();
    store.blueprint_id = 'bp-1';
    store.blueprints = [
      { id: 'bp-1', title: '', one_liner: '', target_age: 12, blueprint_image_id: null },
    ];
    expect(getMysteryTitle(store)).toBe('Unknown Mystery');
  });
});
