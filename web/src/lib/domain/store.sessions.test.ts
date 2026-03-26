import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, getSessionMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('../api/supabase', () => ({
  supabase: {
    functions: {
      invoke: invokeMock,
    },
    auth: {
      getSession: getSessionMock,
    },
  },
}));

import { normalizeSessionCatalog, normalizeSessionSummary, sortSessionSummaries } from './store.svelte';
import { GameSessionStore } from './store.svelte';

describe('session catalog helpers', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: 'test-token',
        },
      },
    });
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
    const sorted = sortSessionSummaries([
      {
        game_id: 'a',
        blueprint_id: 'bp-a',
        mystery_title: 'A',
        mystery_available: true,
        can_open: true,
        mode: 'explore',
        time_remaining: 5,
        outcome: null,
        last_played_at: '2026-03-10T12:00:00.000Z',
        created_at: '2026-03-08T12:00:00.000Z',
      },
      {
        game_id: 'c',
        blueprint_id: 'bp-c',
        mystery_title: 'C',
        mystery_available: true,
        can_open: true,
        mode: 'explore',
        time_remaining: 5,
        outcome: null,
        last_played_at: '2026-03-10T12:00:00.000Z',
        created_at: '2026-03-08T12:00:00.000Z',
      },
      {
        game_id: 'b',
        blueprint_id: 'bp-b',
        mystery_title: 'B',
        mystery_available: true,
        can_open: true,
        mode: 'explore',
        time_remaining: 5,
        outcome: null,
        last_played_at: '2026-03-11T12:00:00.000Z',
        created_at: '2026-03-07T12:00:00.000Z',
      },
    ]);

    expect(sorted.map((entry) => entry.game_id)).toEqual(['b', 'c', 'a']);
  });

  it('normalizes grouped arrays and derives counts from mode', () => {
    const catalog = normalizeSessionCatalog({
      in_progress: [
        {
          game_id: 'g-1',
          blueprint_id: 'bp-1',
          mystery_title: 'Mystery 1',
          mystery_available: true,
          can_open: true,
          mode: 'explore',
          time_remaining: 7,
          outcome: null,
          last_played_at: '2026-03-10T12:00:00.000Z',
          created_at: '2026-03-09T12:00:00.000Z',
        },
      ],
      completed: [
        {
          game_id: 'g-2',
          blueprint_id: 'bp-2',
          mystery_title: 'Mystery 2',
          mystery_available: true,
          can_open: true,
          mode: 'ended',
          time_remaining: 0,
          outcome: 'win',
          last_played_at: '2026-03-11T12:00:00.000Z',
          created_at: '2026-03-08T12:00:00.000Z',
        },
      ],
      counts: {
        in_progress: 999,
        completed: 999,
      },
    });

    expect(catalog.in_progress).toHaveLength(1);
    expect(catalog.completed).toHaveLength(1);
    expect(catalog.counts).toEqual({ in_progress: 1, completed: 1 });
  });

  it('hydrates resumed history only from persisted narration events', async () => {
    const store = new GameSessionStore();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        state: {
          locations: [{ name: 'Kitchen' }],
          characters: [],
          time_remaining: 3,
          location: 'Kitchen',
          mode: 'explore',
          current_talk_character: null,
        },
        narration_events: [
          {
            sequence: 1,
            event_type: 'move',
            narration_parts: [
              {
                text: 'You enter the kitchen.',
                speaker: { kind: 'narrator', key: 'narrator', label: 'Narrator' },
              },
            ],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await store.resumeSession('game-1');

    expect(store.status).toBe('active');
    expect(store.state?.history).toEqual([
      {
        sequence: 1,
        event_type: 'move',
        text: 'You enter the kitchen.',
        speaker: { kind: 'narrator', key: 'narrator', label: 'Narrator' },
        image_id: null,
      },
    ]);
  });

  it('flattens multi-part resumed transcripts without changing order', async () => {
    const store = new GameSessionStore();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        state: {
          locations: [{ id: 'kitchen', name: 'Kitchen' }],
          characters: [{ id: 'char-alice', first_name: 'Alice', last_name: 'Smith', location_name: 'Kitchen' }],
          time_remaining: 0,
          location: 'Kitchen',
          mode: 'ended',
          current_talk_character: null,
        },
        narration_events: [
          {
            sequence: 1,
            event_type: 'ask',
            narration_parts: [
              {
                text: 'Alice says she heard the clock strike nine.',
                speaker: { kind: 'character', key: 'character:alice', label: 'Alice' },
                image_id: 'portrait-alice',
              },
              {
                text: 'The room falls silent as time runs out.',
                speaker: { kind: 'narrator', key: 'narrator', label: 'Narrator' },
              },
            ],
          },
          {
            sequence: 2,
            event_type: 'forced_endgame',
            narration_parts: [
              {
                text: 'You must make your accusation now.',
                speaker: { kind: 'narrator', key: 'narrator', label: 'Narrator' },
              },
            ],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await store.resumeSession('game-2');

    expect(store.status).toBe('active');
    expect(store.state?.mode).toBe('ended');
    expect(store.viewerMode).toBe('read_only_completed');
    expect(store.state?.history).toEqual([
      {
        sequence: 1,
        event_type: 'ask',
        text: 'Alice says she heard the clock strike nine.',
        speaker: { kind: 'character', key: 'character:alice', label: 'Alice' },
        image_id: 'portrait-alice',
      },
      {
        sequence: 1,
        event_type: 'ask',
        text: 'The room falls silent as time runs out.',
        speaker: { kind: 'narrator', key: 'narrator', label: 'Narrator' },
        image_id: null,
      },
      {
        sequence: 2,
        event_type: 'forced_endgame',
        text: 'You must make your accusation now.',
        speaker: { kind: 'narrator', key: 'narrator', label: 'Narrator' },
        image_id: null,
      },
    ]);
  });

  it('surfaces transcript recovery guidance when resume fails', async () => {
    const store = new GameSessionStore();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: 'Failed to load transcript',
        details: {
          recovery: 'Return to the mystery list and reopen the case.',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

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
