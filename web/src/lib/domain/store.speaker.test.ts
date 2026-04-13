import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('../api/supabase', () => ({
  supabase: {
    functions: {
      invoke: invokeMock,
    },
  },
}));

import { GameSessionStore } from './store.svelte';
import { NARRATOR_SPEAKER } from '../../../../tests/testkit/src/fixtures';

function createStore() {
  const store = new GameSessionStore();
  store.game_id = 'game-1';
  store.state = {
    locations: [{ id: 'kitchen', name: 'Kitchen' }, { id: 'garden', name: 'Garden' }],
    characters: [{
      id: 'char-alice',
      first_name: 'Alice',
      last_name: 'Smith',
      location_name: 'Kitchen',
      sex: 'female',
    }],
    time_remaining: 10,
    location: 'Kitchen',
    mode: 'explore',
    current_talk_character: null,
    history: [
      {
        sequence: 1,
        event_type: 'start',
        text: 'Case begins.',
        speaker: NARRATOR_SPEAKER,
      },
    ],
  };
  store.status = 'active';
  return store;
}

describe('store speaker behavior', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('appends investigator input and backend narration speakers', async () => {
    const store = createStore();

    invokeMock.mockResolvedValue({
      data: {
        narration_parts: [{
          text: 'You search the kitchen.',
          speaker: NARRATOR_SPEAKER,
        }],
        mode: 'explore',
        time_remaining: 9,
      },
      error: null,
    });

    await store.submitInput('search');

    const investigatorLine = store.state?.history.find((line) => line.event_type === 'input');
    expect(investigatorLine?.speaker).toMatchObject({
      kind: 'investigator',
      key: 'you',
      label: 'You',
    });

    const backendLine = store.state?.history.find((line) => line.event_type === 'game-search');
    expect(backendLine?.speaker).toMatchObject({
      kind: 'narrator',
      key: 'narrator',
      label: 'Narrator',
    });
  });

  it('keeps help and invalid-target feedback local-only as system speaker', async () => {
    const store = createStore();

    await store.submitInput('help');
    await store.submitInput('go nowhere');

    const systemLines = store.state?.history.filter((line) => line.speaker.kind === 'system') ?? [];
    expect(systemLines.length).toBeGreaterThanOrEqual(1);

    // Only local parsing branches ran; no backend mutation path for these lines.
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('never includes local system lines in backend invoke payloads', async () => {
    const store = createStore();

    invokeMock.mockResolvedValue({
      data: {
        narration_parts: [{
          text: 'You search the kitchen.',
          speaker: NARRATOR_SPEAKER,
        }],
        mode: 'explore',
        time_remaining: 9,
      },
      error: null,
    });

    await store.submitInput('go');
    await store.submitInput('search');

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [, options] = invokeMock.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body).toEqual({ game_id: 'game-1', search_query: null });
    expect(options.body).not.toHaveProperty('history');
    expect(options.body).not.toHaveProperty('system_feedback');
  });
});
