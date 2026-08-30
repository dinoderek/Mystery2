import { beforeEach, describe, expect, it } from 'vitest';
import {
  API_URL,
  MOCK_BLUEPRINT_ID,
  patchStoredSession,
  setupApiTestAuth,
  type ApiAuthContext,
} from './helpers';

async function startSession(auth: ApiAuthContext): Promise<string> {
  const res = await fetch(`${API_URL}/game-start`, {
    method: 'POST',
    headers: auth.headers,
    body: JSON.stringify({ blueprint_id: MOCK_BLUEPRINT_ID }),
  });

  expect(res.status).toBe(200);
  const data = await res.json();
  return data.game_id as string;
}

function patchSession(
  gameId: string,
  patch: Record<string, string | number | null>,
): void {
  patchStoredSession(gameId, patch);
}

describe('game-sessions-list endpoint', () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth('game-sessions-list');
  });


  it('rejects unauthenticated requests', async () => {
    const res = await fetch(`${API_URL}/game-sessions-list`, { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('returns grouped counts and only the authenticated user sessions', async () => {
    const otherUser = await setupApiTestAuth('game-sessions-list-other');

    try {
      const ownInProgress = await startSession(auth);
      const ownCompleted = await startSession(auth);
      patchSession(ownCompleted, {
        mode: 'ended',
        outcome: 'win',
        updated_at: '2026-03-10T09:00:00.000Z',
      });

      await startSession(otherUser);

      const res = await fetch(`${API_URL}/game-sessions-list`, {
        method: 'GET',
        headers: auth.headers,
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.counts).toEqual({ in_progress: 1, completed: 1 });

      const allIds = [
        ...data.in_progress.map((entry: { game_id: string }) => entry.game_id),
        ...data.completed.map((entry: { game_id: string }) => entry.game_id),
      ];

      expect(allIds).toContain(ownInProgress);
      expect(allIds).toContain(ownCompleted);
      expect(allIds).toHaveLength(2);
    } finally {
      // Nothing to clean up: the run's database is deleted with its config root.
    }
  });

  it('sorts each category by last played descending and includes display fields', async () => {
    const inProgressOlder = await startSession(auth);
    const inProgressNewer = await startSession(auth);
    const completedOlder = await startSession(auth);
    const completedNewer = await startSession(auth);

    patchSession(inProgressOlder, {
      mode: 'explore',
      time_remaining: 4,
      updated_at: '2026-03-09T09:00:00.000Z',
      created_at: '2026-03-08T09:00:00.000Z',
    });
    patchSession(inProgressNewer, {
      mode: 'talk',
      time_remaining: 8,
      updated_at: '2026-03-10T09:00:00.000Z',
      created_at: '2026-03-08T10:00:00.000Z',
    });

    patchSession(completedOlder, {
      mode: 'ended',
      outcome: 'lose',
      updated_at: '2026-03-07T09:00:00.000Z',
      created_at: '2026-03-06T09:00:00.000Z',
    });
    patchSession(completedNewer, {
      mode: 'ended',
      outcome: 'win',
      updated_at: '2026-03-11T09:00:00.000Z',
      created_at: '2026-03-06T10:00:00.000Z',
    });

    const res = await fetch(`${API_URL}/game-sessions-list`, {
      method: 'GET',
      headers: auth.headers,
    });
    expect(res.status).toBe(200);

    const data = await res.json();

    expect(data.in_progress.map((entry: { game_id: string }) => entry.game_id)).toEqual([
      inProgressNewer,
      inProgressOlder,
    ]);
    expect(data.completed.map((entry: { game_id: string }) => entry.game_id)).toEqual([
      completedNewer,
      completedOlder,
    ]);

    expect(data.in_progress[0]).toMatchObject({
      mystery_title: expect.any(String),
      time_remaining: 8,
      can_open: true,
      mystery_available: true,
      mode: 'talk',
    });
    expect(data.completed[0]).toMatchObject({
      mystery_title: expect.any(String),
      outcome: 'win',
      can_open: true,
      mystery_available: true,
      mode: 'ended',
    });
  });

  it('keeps sessions with missing blueprints visible but disabled', async () => {
    const gameId = await startSession(auth);

    patchSession(gameId, {
      blueprint_id: crypto.randomUUID(),
      mode: 'ended',
      outcome: null,
      updated_at: '2026-03-12T09:00:00.000Z',
    });

    const res = await fetch(`${API_URL}/game-sessions-list`, {
      method: 'GET',
      headers: auth.headers,
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    const row = data.completed.find((entry: { game_id: string }) => entry.game_id === gameId);

    expect(row).toMatchObject({
      mystery_title: 'Unknown Mystery',
      mystery_available: false,
      can_open: false,
      mode: 'ended',
      outcome: null,
    });
  });
});
