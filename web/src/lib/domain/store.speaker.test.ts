import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('../api/client', () => ({
  callApi: invokeMock,
  callApiGet: vi.fn(),
  blueprintImageUrl: (blueprintId: string, imageId: string) =>
    `/api/images/${blueprintId}/${imageId}`,
}));

import { GameSessionStore } from './store.svelte';
import {
  NARRATOR_SPEAKER,
  createRevealedClue,
  createTurnPlayedResponse,
  createTurnRefusedResponse,
  createTurnViewResponse,
} from '../../../../tests/testkit/src/fixtures';

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
        narration_parts: [{ text: 'Case begins.', speaker: NARRATOR_SPEAKER }],
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
      data: createTurnPlayedResponse({
        events: [
          {
            sequence: 2,
            event_type: 'search',
            payload: { input: 'search' },
            narration_parts: [{ text: 'You search the kitchen.', speaker: NARRATOR_SPEAKER }],
          },
        ],
      }),
      error: null,
    });

    await store.submitInput('search');

    const investigatorEvent = store.state?.history.find((event) => event.event_type === 'input');
    expect(investigatorEvent?.narration_parts[0].speaker).toMatchObject({
      kind: 'investigator',
      key: 'you',
      label: 'You',
    });

    // The client stamps the backend's own event type, not the endpoint name, so
    // a live turn and a resumed one group into the same page.
    const backendEvent = store.state?.history.find((event) => event.event_type === 'search');
    expect(backendEvent?.narration_parts[0].speaker).toMatchObject({
      kind: 'narrator',
      key: 'narrator',
      label: 'Narrator',
    });
  });

  it('shows a refusal and help as system lines, and sends nothing but the line', async () => {
    const store = createStore();

    invokeMock.mockResolvedValueOnce({ data: createTurnViewResponse({ view: 'help' }), error: null });
    await store.submitInput('help');
    invokeMock.mockResolvedValueOnce({
      data: createTurnRefusedResponse({ reason: 'invalid-target', hint: '"nowhere" is not a valid destination.' }),
      error: null,
    });
    await store.submitInput('go nowhere');

    const systemLines =
      store.state?.history.flatMap((event) => event.narration_parts).filter(
        (line) => line.speaker.kind === 'system',
      ) ?? [];
    expect(systemLines.map((line) => line.text)).toEqual([
      'Help menu opened.',
      '"nowhere" is not a valid destination.',
    ]);
    expect(store.showHelp).toBe(true);
    // Neither line played anything: the player's own words stay on the screen.
    const echoes = store.state?.history.filter((event) => event.event_type === 'input') ?? [];
    expect(echoes.map((event) => event.narration_parts[0].text)).toEqual(['help', 'go nowhere']);
  });

  it('opens the notebook on the "notebook" command and takes the echo back', async () => {
    const store = createStore();
    const historyLength = store.state!.history.length;
    expect(store.showNotebook).toBe(false);

    invokeMock.mockResolvedValue({ data: createTurnViewResponse({ view: 'notebook', section: null }), error: null });
    await store.submitInput('notebook');

    expect(store.showNotebook).toBe(true);
    expect(store.notebookSection).toBe('story');
    expect(invokeMock).toHaveBeenCalledWith('game-turn', { game_id: 'game-1', input: 'notebook' });
    // Costs no turn and leaves no trace in the transcript.
    expect(store.state!.history).toHaveLength(historyLength);
  });

  it('opens the notebook at the section the answer names for the list commands', async () => {
    const store = createStore();
    const historyLength = store.state!.history.length;

    invokeMock.mockResolvedValueOnce({
      data: createTurnViewResponse({ view: 'locations', section: 'places' }),
      error: null,
    });
    await store.submitInput('locations');
    expect(store.showNotebook).toBe(true);
    expect(store.notebookSection).toBe('places');

    store.closeNotebook();
    invokeMock.mockResolvedValueOnce({
      data: createTurnViewResponse({ view: 'characters', section: 'people' }),
      error: null,
    });
    await store.submitInput('who is here');
    expect(store.showNotebook).toBe(true);
    expect(store.notebookSection).toBe('people');

    expect(store.state!.history).toHaveLength(historyLength);
  });

  it('reopens at the last section when no section is given', async () => {
    const store = createStore();

    invokeMock.mockResolvedValueOnce({
      data: createTurnViewResponse({ view: 'characters', section: 'people' }),
      error: null,
    });
    await store.submitInput('characters');
    store.closeNotebook();
    invokeMock.mockResolvedValueOnce({
      data: createTurnViewResponse({ view: 'notebook', section: null }),
      error: null,
    });
    await store.submitInput('n');

    expect(store.notebookSection).toBe('people');
  });

  it('closes help when the notebook opens', () => {
    const store = createStore();
    store.showHelp = true;

    store.openNotebook('clues');

    expect(store.showHelp).toBe(false);
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

  it('merges revealed_clues from a turn into discovered_clues', async () => {
    const store = createStore();

    const crumbClue = createRevealedClue();
    // The wire answer here still carries spoiler-bearing `threads`, as a stale
    // or legacy response could. The schema must drop it on the way in.
    const wire = {
      ...createTurnPlayedResponse({ revealed_clues: [crumbClue] }),
      revealed_clues: [{ ...crumbClue, threads: [{ kind: 'solution', label: 'Main solution' }] }],
    };

    invokeMock.mockResolvedValue({ data: wire, error: null });

    expect(store.state?.discovered_clues).toEqual([]);
    await store.submitInput('search');

    expect(store.state?.discovered_clues).toEqual([crumbClue]);
    expect(store.recentlyDiscovered).toEqual([crumbClue]);

    // A second search revealing the same clue does not duplicate it.
    await store.submitInput('search');
    expect(store.state?.discovered_clues).toEqual([crumbClue]);
  });
});
