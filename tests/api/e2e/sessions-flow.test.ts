import { beforeEach, describe, expect, it } from 'vitest';
import {
  API_URL,
  MOCK_BLUEPRINT_ID,
  playLine,
  sendLine,
  setStoredTimeRemaining,
  setupApiTestAuth,
  type ApiAuthContext,
} from '../integration/helpers';

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
  });


  it('replays an in-progress session without changing the persisted transcript', async () => {
    const gameId = await startSession(auth);

    await playLine(auth, gameId, 'talk to Alice');
    await playLine(auth, gameId, 'Where were you when the cookies disappeared?');

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
    expect(row).toMatchObject({ mystery_available: true, mode: 'talk' });

    const resumedGetRes = await fetch(`${API_URL}/game-get?game_id=${gameId}`, {
      method: 'GET',
      headers: auth.headers,
    });
    expect(resumedGetRes.status).toBe(200);
    const resumedGetData = await resumedGetRes.json();
    expect(resumedGetData.state.mode).toBe('talk');
    expect(resumedGetData.narration_events).toEqual(preResumeData.narration_events);
  });

  it('preserves player inputs in the transcript on resume', async () => {
    const gameId = await startSession(auth);

    await playLine(auth, gameId, 'talk to Alice');
    const playerQuestion = 'Where were you when the cookies disappeared?';
    await playLine(auth, gameId, playerQuestion);

    const resumed = await loadSessionTranscript(auth, gameId);
    const askEvent = resumed.narration_events.find(
      (e: { event_type: string }) => e.event_type === 'ask',
    );
    expect(askEvent).toBeDefined();

    // The ask event must include the player's typed input as an investigator
    // narration part so that the transcript shows the player's question on resume.
    const investigatorParts = askEvent.narration_parts.filter(
      (p: { speaker: { kind: string } }) => p.speaker.kind === 'investigator',
    );
    expect(investigatorParts.length).toBeGreaterThanOrEqual(1);
    expect(investigatorParts[0].text).toBe(playerQuestion);
  });

  it('preserves player reasoning in the transcript on resume (accuse)', async () => {
    const gameId = await startSession(auth);

    const playerReasoning = 'accuse Alice based on motive and opportunity.';
    await playLine(auth, gameId, playerReasoning);

    const resumed = await loadSessionTranscript(auth, gameId);
    // Find the accuse event that carries player reasoning (accuse_failed or accuse_resolved)
    const accuseEvent = resumed.narration_events.find(
      (e: { event_type: string }) =>
        e.event_type === 'accuse_failed' || e.event_type === 'accuse_resolved',
    );
    expect(accuseEvent).toBeDefined();

    const investigatorParts = accuseEvent.narration_parts.filter(
      (p: { speaker: { kind: string } }) => p.speaker.kind === 'investigator',
    );
    expect(investigatorParts.length).toBeGreaterThanOrEqual(1);
    expect(investigatorParts[0].text).toBe(playerReasoning);
  });

  it('preserves targeted search query in the transcript on resume', async () => {
    const gameId = await startSession(auth);

    await playLine(auth, gameId, 'search check under the sink');

    const resumed = await loadSessionTranscript(auth, gameId);
    const searchEvent = resumed.narration_events.find(
      (e: { event_type: string }) => e.event_type === 'search',
    );
    expect(searchEvent).toBeDefined();

    const investigatorParts = searchEvent.narration_parts.filter(
      (p: { speaker: { kind: string } }) => p.speaker.kind === 'investigator',
    );
    expect(investigatorParts.length).toBeGreaterThanOrEqual(1);
    expect(investigatorParts[0].text).toBe('search check under the sink');
  });

  it('preserves bare search as "search" in the transcript on resume', async () => {
    const gameId = await startSession(auth);

    await playLine(auth, gameId, 'search');

    const resumed = await loadSessionTranscript(auth, gameId);
    const searchEvent = resumed.narration_events.find(
      (e: { event_type: string }) => e.event_type === 'search',
    );
    expect(searchEvent).toBeDefined();

    const investigatorParts = searchEvent.narration_parts.filter(
      (p: { speaker: { kind: string } }) => p.speaker.kind === 'investigator',
    );
    expect(investigatorParts.length).toBeGreaterThanOrEqual(1);
    expect(investigatorParts[0].text).toBe('search');
  });

  it('opens a completed session in ended mode with persisted history', async () => {
    const gameId = await startSession(auth);
    // One route to the culprit: the empty jar, and the score sheet that clears Bob.
    for (const line of ['search the pantry shelf', 'go to the Living Room', 'search']) await playLine(auth, gameId, line);

    const verdict = await playLine(auth, gameId, 'accuse Alice: the cookie jar is empty, and Bob was playing his board game.');
    expect(verdict.state.mode).toBe('ended');

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
    expect(completedRow.mystery_available).toBe(true);
    expect(completedRow.mode).toBe('ended');

    const getData = await loadSessionTranscript(auth, gameId);

    expect(getData.state.mode).toBe('ended');
    expect(getData.narration_events.length).toBeGreaterThan(1);
    const lastEventParts = getData.narration_events.at(-1)?.narration_parts ?? [];
    expect(lastEventParts.some((p: { speaker: { kind: string } }) => p.speaker.kind === 'narrator')).toBe(true);
    expect(
      getData.narration_events.map((entry: { event_type: string }) => entry.event_type),
    ).toEqual(['start', 'search', 'move', 'search', 'accuse_resolved']);
    expect(getData.narration_events).toEqual(preResumeData.narration_events);
  });
});

describe('three accusations, each one shot', () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth('accusations-flow');
  });

  it('fails one accusation, explores again, and wins', async () => {
    const gameId = await startSession(auth);

    const failed = await playLine(auth, gameId, 'accuse Bob because he was in the living room');
    expect(failed.events[0].event_type).toBe('accuse_failed');
    expect(failed.state).toMatchObject({ mode: 'explore', accusations_left: 2 });

    const searched = await playLine(auth, gameId, 'search');
    expect(searched.state).toMatchObject({ mode: 'explore', time_remaining: 9, accusations_left: 2 });

    for (const line of ['search the pantry shelf', 'go to the Living Room', 'search']) await playLine(auth, gameId, line);
    await playLine(auth, gameId, 'accuse');
    const won = await playLine(auth, gameId, 'Alice took them: the cookie jar is empty, and Bob was playing his board game.');
    expect(won.result).toBe('win');
    expect(won.state).toMatchObject({ mode: 'ended', accusations_left: 2 });
  });

  it('fails three times and ends lost, with the closing scene', async () => {
    const gameId = await startSession(auth);

    const left: number[] = [];
    for (const line of ['accuse Bob', 'accuse Bob, again', 'accuse Bob, for sure']) {
      left.push((await playLine(auth, gameId, line)).state.accusations_left);
    }
    expect(left).toEqual([2, 1, 0]);

    const resumed = await loadSessionTranscript(auth, gameId);
    expect(resumed.state).toMatchObject({ mode: 'ended', accusations_left: 0 });
    expect(resumed.narration_events.map((event: { event_type: string }) => event.event_type)).toEqual([
      'start',
      'accuse_failed',
      'accuse_failed',
      'accuse_resolved',
    ]);
    expect(resumed.narration_events.at(-1).payload).toMatchObject({ judge_result: 'lose' });
  });

  it('runs out of turns and spends its accusations back to back', async () => {
    const gameId = await startSession(auth);
    setStoredTimeRemaining(gameId, 1);

    expect((await playLine(auth, gameId, 'search')).state).toMatchObject({ mode: 'accuse', time_remaining: 0, accusations_left: 3 });
    const back = await (await sendLine(auth, gameId, 'back')).json();
    expect(back).toMatchObject({ kind: 'refused', reason: 'no-way-back' });

    expect((await playLine(auth, gameId, 'It was Bob')).state).toMatchObject({ mode: 'accuse', accusations_left: 2 });
    expect((await playLine(auth, gameId, 'It was Bob, I said')).state).toMatchObject({ mode: 'accuse', accusations_left: 1 });
    const lost = await playLine(auth, gameId, 'Bob!');
    expect(lost.result).toBe('lose');
    expect(lost.state).toMatchObject({ mode: 'ended', accusations_left: 0 });
  });
});
