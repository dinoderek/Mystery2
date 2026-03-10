import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_URL, setupApiTestAuth, type ApiAuthContext } from '../integration/auth-helpers';

const BLUEPRINT_ID = '123e4567-e89b-12d3-a456-426614174000';

async function startSession(auth: ApiAuthContext): Promise<string> {
  const startRes = await fetch(`${API_URL}/game-start`, {
    method: 'POST',
    headers: auth.headers,
    body: JSON.stringify({ blueprint_id: BLUEPRINT_ID }),
  });
  expect(startRes.status).toBe(200);
  const startData = await startRes.json();
  return startData.game_id as string;
}

describe('session list resume/view API flows', () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth('sessions-flow');
  });

  afterEach(async () => {
    await auth.cleanup();
  });

  it('resumes an in-progress session and remains interactive', async () => {
    const gameId = await startSession(auth);

    const listRes = await fetch(`${API_URL}/game-sessions-list`, {
      method: 'GET',
      headers: auth.headers,
    });
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    const row = listData.in_progress.find((entry: { game_id: string }) => entry.game_id === gameId);
    expect(row).toMatchObject({ can_open: true, mode: 'explore' });

    const getRes = await fetch(`${API_URL}/game-get?game_id=${gameId}`, {
      method: 'GET',
      headers: auth.headers,
    });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.state.mode).not.toBe('ended');

    const searchRes = await fetch(`${API_URL}/game-search`, {
      method: 'POST',
      headers: auth.headers,
      body: JSON.stringify({ game_id: gameId }),
    });
    expect(searchRes.status).toBe(200);
    const searchData = await searchRes.json();
    expect(searchData.mode).toBeTypeOf('string');
  });

  it('opens a completed session in ended mode with persisted history', async () => {
    const gameId = await startSession(auth);

    const accuseStartRes = await fetch(`${API_URL}/game-accuse`, {
      method: 'POST',
      headers: auth.headers,
      body: JSON.stringify({
        game_id: gameId,
        player_reasoning: 'I accuse Alice based on motive and opportunity.',
      }),
    });
    expect(accuseStartRes.status).toBe(200);

    const accuseJudgeRes = await fetch(`${API_URL}/game-accuse`, {
      method: 'POST',
      headers: auth.headers,
      body: JSON.stringify({
        game_id: gameId,
        player_reasoning: 'Alice lied about where she was and had crumbs on her coat.',
      }),
    });
    expect(accuseJudgeRes.status).toBe(200);
    const accuseJudgeData = await accuseJudgeRes.json();
    expect(accuseJudgeData.mode).toBe('ended');

    const listRes = await fetch(`${API_URL}/game-sessions-list`, {
      method: 'GET',
      headers: auth.headers,
    });
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    const completedRow = listData.completed.find((entry: { game_id: string }) => entry.game_id === gameId);

    expect(completedRow).toBeDefined();
    expect(completedRow.can_open).toBe(true);
    expect(completedRow.mode).toBe('ended');

    const getRes = await fetch(`${API_URL}/game-get?game_id=${gameId}`, {
      method: 'GET',
      headers: auth.headers,
    });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();

    expect(getData.state.mode).toBe('ended');
    expect(getData.state.history.length).toBeGreaterThan(1);
    expect(getData.state.narration_speaker.kind).toBe('narrator');
  });
});
