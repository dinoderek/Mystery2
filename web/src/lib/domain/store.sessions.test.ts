import { describe, expect, it } from 'vitest';
import { normalizeSessionCatalog, normalizeSessionSummary, sortSessionSummaries } from './store.svelte';

describe('session catalog helpers', () => {
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
});
