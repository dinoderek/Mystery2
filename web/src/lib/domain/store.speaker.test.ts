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
    mystery_summary: null,
    premise: null,
    locations: [{ id: 'kitchen', name: 'Kitchen' }, { id: 'garden', name: 'Garden' }],
    characters: [{
      id: 'char-alice',
      first_name: 'Alice',
      last_name: 'Smith',
      location_name: 'Kitchen',
      sex: 'female',
    }],
    discovered_clues: [],
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

  it('opens the notebook on the "notebook" command without a backend call', async () => {
    const store = createStore();
    const historyLength = store.state!.history.length;
    expect(store.showNotebook).toBe(false);

    await store.submitInput('notebook');

    expect(store.showNotebook).toBe(true);
    expect(store.notebookSection).toBe('story');
    expect(invokeMock).not.toHaveBeenCalled();
    // Costs no turn and leaves no trace in the transcript.
    expect(store.state!.history).toHaveLength(historyLength);
  });

  it('opens the notebook at the matching section for the list commands', async () => {
    const store = createStore();
    const historyLength = store.state!.history.length;

    await store.submitInput('locations');
    expect(store.showNotebook).toBe(true);
    expect(store.notebookSection).toBe('places');

    store.closeNotebook();
    await store.submitInput('who is here');
    expect(store.showNotebook).toBe(true);
    expect(store.notebookSection).toBe('people');

    expect(invokeMock).not.toHaveBeenCalled();
    expect(store.state!.history).toHaveLength(historyLength);
  });

  it('reopens at the last section when no section is given', async () => {
    const store = createStore();

    await store.submitInput('characters');
    store.closeNotebook();
    await store.submitInput('n');

    expect(store.notebookSection).toBe('people');
  });

  it('closes the other overlays when the notebook opens', () => {
    const store = createStore();
    store.showHelp = true;
    store.showZoomModal = true;

    store.openNotebook('clues');

    expect(store.showHelp).toBe(false);
    expect(store.showZoomModal).toBe(false);
    expect(store.notebookSection).toBe('clues');
  });

  it('toggles the notebook shut and back open', () => {
    const store = createStore();

    store.toggleNotebook();
    expect(store.showNotebook).toBe(true);

    store.toggleNotebook();
    expect(store.showNotebook).toBe(false);
  });

  it('resets the notebook when the session is cleared', () => {
    const store = createStore();
    store.openNotebook('clues');

    store.clearSessionForMysteryList();

    expect(store.showNotebook).toBe(false);
    expect(store.notebookSection).toBe('story');
  });

  it('merges revealed_clues from a search response into discovered_clues', async () => {
    const store = createStore();

    const storedCrumbClue = {
      id: 'clue-crumbs',
      text: 'Crumbs on the floor.',
      source: 'search',
      origin: { kind: 'location', location_id: 'loc-kitchen', location_name: 'Kitchen' },
      discovered_at: '2026-06-01T10:00:00Z',
      off_script: false,
    };
    // The wire payload here still carries spoiler-bearing `threads`, as a stale
    // or legacy response could. The store must drop it on the way in.
    const crumbClue = {
      ...storedCrumbClue,
      threads: [{ kind: 'solution', label: 'Main solution' }],
    };

    invokeMock.mockResolvedValue({
      data: {
        narration_parts: [{ text: 'You find crumbs.', speaker: NARRATOR_SPEAKER }],
        mode: 'explore',
        time_remaining: 9,
        revealed_clues: [crumbClue],
      },
      error: null,
    });

    expect(store.state?.discovered_clues).toEqual([]);
    await store.submitInput('search');

    expect(store.state?.discovered_clues).toEqual([storedCrumbClue]);

    // A second search revealing the same clue does not duplicate it.
    await store.submitInput('search');
    expect(store.state?.discovered_clues).toEqual([storedCrumbClue]);
  });
});
