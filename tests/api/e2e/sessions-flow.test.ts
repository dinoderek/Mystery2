import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  API_URL,
  ensureMockBlueprintSeeded,
  MOCK_BLUEPRINT_ID,
  setupApiTestAuth,
  type ApiAuthContext,
} from '../integration/auth-helpers';

async function startSession(auth: ApiAuthContext): Promise<string> {
  const startRes = await fetch(`${API_URL}/game-start`, {
    method: 'POST',
    headers: auth.headers,
    body: JSON.stringify({ blueprint_id: MOCK_BLUEPRINT_ID }),
  });
  expect(startRes.status).toBe(200);
  const startData = await startRes.json();
  return startData.game_id as string;
}

async function loadSessionTranscript(auth: ApiAuthContext, gameId: string) {
  const getRes = await fetch(`${API_URL}/game-get?game_id=${gameId}`, {
    method: 'GET',
    headers: auth.headers,
  });
  expect(getRes.status).toBe(200);
  return await getRes.json();
}

describe('session list resume/view API flows', () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth('sessions-flow');
    await ensureMockBlueprintSeeded();
  });

  afterEach(async () => {
    await auth.cleanup();
  });

  it('replays an in-progress session without changing the persisted transcript', async () => {
    const gameId = await startSession(auth);

    const talkRes = await fetch(`${API_URL}/game-talk`, {
      method: 'POST',
      headers: auth.headers,
      body: JSON.stringify({ game_id: gameId, character_id: 'char-alice' }),
    });
    expect(talkRes.status).toBe(200);

    const askRes = await fetch(`${API_URL}/game-ask`, {
      method: 'POST',
      headers: auth.headers,
      body: JSON.stringify({
        game_id: gameId,
        player_input: 'Where were you when the cookies disappeared?',
      }),
    });
    expect(askRes.status).toBe(200);

    const preResumeData = await loadSessionTranscript(auth, gameId);
    expect(
      preResumeData.narration_events.map((entry: { event_type: string }) => entry.event_type),
    ).toEqual(['start', 'talk', 'ask']);

    const listRes = await fetch(`${API_URL}/game-sessions-list`, {
      method: 'GET',
      headers: auth.headers,
    });
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    const row = listData.in_progress.find((entry: { game_id: string }) => entry.game_id === gameId);
    expect(row).toMatchObject({ can_open: true, mode: 'talk' });

    const resumedGetRes = await fetch(`${API_URL}/game-get?game_id=${gameId}`, {
      method: 'GET',
      headers: auth.headers,
    });
    expect(resumedGetRes.status).toBe(200);
    const resumedGetData = await resumedGetRes.json();
    expect(resumedGetData.state.mode).toBe('talk');
    expect(resumedGetData.narration_events).toEqual(preResumeData.narration_events);
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

    const preResumeData = await loadSessionTranscript(auth, gameId);
    expect(preResumeData.state.mode).toBe('ended');

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

    const getData = await loadSessionTranscript(auth, gameId);

    expect(getData.state.mode).toBe('ended');
    expect(getData.narration_events.length).toBeGreaterThan(1);
    expect(getData.narration_events.at(-1)?.narration_parts[0].speaker.kind).toBe('narrator');
    expect(
      getData.narration_events.map((entry: { event_type: string }) => entry.event_type),
    ).toEqual(['start', 'accuse_round', 'accuse_resolved']);
    expect(getData.narration_events).toEqual(preResumeData.narration_events);
  });
});
