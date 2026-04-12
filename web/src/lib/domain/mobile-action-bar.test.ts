import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../types/game';

const storeMock = vi.hoisted(() => ({
  submitInput: vi.fn(),
  status: 'active' as string,
  state: null as GameState | null,
}));

vi.mock('./store.svelte', () => ({
  gameSessionStore: storeMock,
}));

import { MobileActionBarState, type PickerItem } from './mobile-action-bar.svelte';

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    locations: [
      { id: 'library', name: 'Library' },
      { id: 'kitchen', name: 'Kitchen' },
    ],
    characters: [
      {
        id: 'c1',
        first_name: 'Alice',
        last_name: 'Smith',
        location_name: 'library',
        sex: 'female',
      },
      {
        id: 'c2',
        first_name: 'Bob',
        last_name: 'Jones',
        location_name: 'kitchen',
        sex: 'male',
      },
    ],
    time_remaining: 10,
    location: 'library',
    mode: 'explore',
    current_talk_character: null,
    history: [],
    ...overrides,
  };
}

describe('MobileActionBarState', () => {
  let bar: MobileActionBarState;

  beforeEach(() => {
    bar = new MobileActionBarState();
    storeMock.status = 'active';
    storeMock.state = makeState();
    storeMock.submitInput.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- mode ---

  it('returns explore mode by default', () => {
    expect(bar.mode).toBe('explore');
  });

  it('reflects talk mode from store', () => {
    storeMock.state = makeState({ mode: 'talk' });
    expect(bar.mode).toBe('talk');
  });

  it('reflects accuse mode from store', () => {
    storeMock.state = makeState({ mode: 'accuse' });
    expect(bar.mode).toBe('accuse');
  });

  it('defaults to explore when state is null', () => {
    storeMock.state = null;
    expect(bar.mode).toBe('explore');
  });

  // --- isLoading ---

  it('isLoading is false when status is active', () => {
    storeMock.status = 'active';
    expect(bar.isLoading).toBe(false);
  });

  it('isLoading is true when status is loading', () => {
    storeMock.status = 'loading';
    expect(bar.isLoading).toBe(true);
  });

  // --- locationItems ---

  it('returns location items with character subtitles', () => {
    const items = bar.locationItems;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      id: 'library',
      label: 'Library',
      subtitle: 'Alice Smith',
    });
    expect(items[1]).toEqual({
      id: 'kitchen',
      label: 'Kitchen',
      subtitle: 'Bob Jones',
    });
  });

  it('shows (empty) for locations with no characters', () => {
    storeMock.state = makeState({
      characters: [
        {
          id: 'c1',
          first_name: 'Alice',
          last_name: 'Smith',
          location_name: 'library',
          sex: 'female',
        },
      ],
    });
    const items = bar.locationItems;
    const kitchen = items.find((i) => i.id === 'kitchen');
    expect(kitchen?.subtitle).toBe('(empty)');
  });

  it('returns empty array when state is null', () => {
    storeMock.state = null;
    expect(bar.locationItems).toEqual([]);
  });

  // --- characterItems ---

  it('returns characters at current location', () => {
    const items = bar.characterItems;
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      id: 'c1',
      label: 'Alice Smith',
    });
  });

  it('returns empty array when no characters at current location', () => {
    storeMock.state = makeState({ location: 'garden' });
    expect(bar.characterItems).toEqual([]);
  });

  it('returns empty array when state is null', () => {
    storeMock.state = null;
    expect(bar.characterItems).toEqual([]);
  });

  it('matches location case-insensitively', () => {
    storeMock.state = makeState({
      location: 'LIBRARY',
      characters: [
        {
          id: 'c1',
          first_name: 'Alice',
          last_name: 'Smith',
          location_name: 'library',
          sex: 'female',
        },
      ],
    });
    expect(bar.characterItems).toHaveLength(1);
  });

  // --- talkDisabled ---

  it('talkDisabled is false when characters are at current location', () => {
    expect(bar.talkDisabled).toBe(false);
  });

  it('talkDisabled is true when no characters at current location', () => {
    storeMock.state = makeState({ location: 'garden' });
    expect(bar.talkDisabled).toBe(true);
  });

  // --- picker state ---

  it('activePicker starts as null', () => {
    expect(bar.activePicker).toBeNull();
  });

  it('openLocationPicker sets activePicker to locations', () => {
    bar.openLocationPicker();
    expect(bar.activePicker).toBe('locations');
  });

  it('openCharacterPicker sets activePicker to characters', () => {
    bar.openCharacterPicker();
    expect(bar.activePicker).toBe('characters');
  });

  it('closePicker sets activePicker to null', () => {
    bar.openLocationPicker();
    bar.closePicker();
    expect(bar.activePicker).toBeNull();
  });

  // --- selectLocation ---

  it('selectLocation submits go to command and closes picker', () => {
    bar.openLocationPicker();
    const item: PickerItem = { id: 'kitchen', label: 'Kitchen' };
    bar.selectLocation(item);
    expect(storeMock.submitInput).toHaveBeenCalledWith('go to Kitchen');
    expect(bar.activePicker).toBeNull();
  });

  // --- selectCharacter ---

  it('selectCharacter submits talk to command and closes picker', () => {
    bar.openCharacterPicker();
    const item: PickerItem = { id: 'c1', label: 'Alice Smith' };
    bar.selectCharacter(item);
    expect(storeMock.submitInput).toHaveBeenCalledWith('talk to Alice Smith');
    expect(bar.activePicker).toBeNull();
  });

  // --- submitSearch ---

  it('submitSearch calls submitInput with search', () => {
    bar.submitSearch();
    expect(storeMock.submitInput).toHaveBeenCalledWith('search');
  });

  // --- submitEndConvo ---

  it('submitEndConvo calls submitInput with bye', () => {
    bar.submitEndConvo();
    expect(storeMock.submitInput).toHaveBeenCalledWith('bye');
  });
});
