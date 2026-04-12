import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeMock = vi.hoisted(() => ({
  state: null as {
    locations: { id: string; name: string }[];
    characters: { first_name: string; last_name: string; location_name: string }[];
    time_remaining: number;
    location: string;
  } | null,
  showHelp: false,
  showZoomModal: false,
  activeStoryImage: null as { image_id: string } | null,
  submitInput: vi.fn(),
  setTheme: vi.fn(),
}));

const themeMock = vi.hoisted(() => ({
  activeId: 'classic',
  getThemeList: vi.fn(() => [
    { id: 'classic', name: 'Classic Green', colors: {} },
    { id: 'amber', name: 'Amber', colors: {} },
    { id: 'ice', name: 'Ice', colors: {} },
    { id: 'phosphor', name: 'Phosphor', colors: {} },
    { id: 'noir', name: 'Noir', colors: {} },
  ]),
  getActiveTheme: vi.fn(() => ({ id: 'classic', name: 'Classic Green', colors: {} })),
  setTheme: vi.fn(() => true),
}));

const prefsMock = vi.hoisted(() => ({
  textSize: 'base' as string,
  setTextSize: vi.fn(),
}));

vi.mock('./store.svelte', () => ({
  gameSessionStore: storeMock,
}));

vi.mock('./theme-store.svelte', () => ({
  themeStore: themeMock,
}));

vi.mock('./mobile-prefs.svelte', () => ({
  mobilePrefs: prefsMock,
}));

import { MobileDrawerState } from './mobile-drawer.svelte';

describe('MobileDrawerState', () => {
  let drawer: MobileDrawerState;

  beforeEach(() => {
    drawer = new MobileDrawerState();
    storeMock.state = null;
    storeMock.showHelp = false;
    storeMock.showZoomModal = false;
    storeMock.activeStoryImage = null;
    storeMock.submitInput.mockReset();
    storeMock.setTheme.mockReset();
    themeMock.activeId = 'classic';
    themeMock.getActiveTheme.mockReturnValue({ id: 'classic', name: 'Classic Green', colors: {} });
    themeMock.setTheme.mockReset().mockReturnValue(true);
    themeMock.getThemeList.mockClear();
    prefsMock.textSize = 'base';
    prefsMock.setTextSize.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- currentLocationName ---

  it('returns UNKNOWN when state is null', () => {
    expect(drawer.currentLocationName).toBe('UNKNOWN');
  });

  it('returns location name when location id matches', () => {
    storeMock.state = {
      locations: [
        { id: 'loc-1', name: 'Library' },
        { id: 'loc-2', name: 'Kitchen' },
      ],
      characters: [],
      time_remaining: 10,
      location: 'loc-1',
    };
    expect(drawer.currentLocationName).toBe('Library');
  });

  it('falls back to raw location id when no match found', () => {
    storeMock.state = {
      locations: [{ id: 'loc-1', name: 'Library' }],
      characters: [],
      time_remaining: 10,
      location: 'loc-unknown',
    };
    expect(drawer.currentLocationName).toBe('loc-unknown');
  });

  // --- visibleCharacters ---

  it('returns empty array when state is null', () => {
    expect(drawer.visibleCharacters).toEqual([]);
  });

  it('filters characters by current location (case-insensitive)', () => {
    storeMock.state = {
      locations: [{ id: 'loc-1', name: 'Library' }],
      characters: [
        { first_name: 'Alice', last_name: 'Smith', location_name: 'loc-1' },
        { first_name: 'Bob', last_name: 'Jones', location_name: 'loc-2' },
        { first_name: 'Carol', last_name: 'White', location_name: 'LOC-1' },
      ],
      time_remaining: 10,
      location: 'loc-1',
    };
    const chars = drawer.visibleCharacters;
    expect(chars).toHaveLength(2);
    expect(chars[0].first_name).toBe('Alice');
    expect(chars[1].first_name).toBe('Carol');
  });

  it('returns empty array when no characters at current location', () => {
    storeMock.state = {
      locations: [{ id: 'loc-1', name: 'Library' }],
      characters: [
        { first_name: 'Bob', last_name: 'Jones', location_name: 'loc-2' },
      ],
      time_remaining: 10,
      location: 'loc-1',
    };
    expect(drawer.visibleCharacters).toEqual([]);
  });

  // --- timeRemaining ---

  it('returns 0 when state is null', () => {
    expect(drawer.timeRemaining).toBe(0);
  });

  it('returns time_remaining from state', () => {
    storeMock.state = {
      locations: [],
      characters: [],
      time_remaining: 7,
      location: 'loc-1',
    };
    expect(drawer.timeRemaining).toBe(7);
  });

  // --- hasActiveImage ---

  it('returns false when activeStoryImage is null', () => {
    expect(drawer.hasActiveImage).toBe(false);
  });

  it('returns true when activeStoryImage is set', () => {
    storeMock.activeStoryImage = { image_id: 'img-1' };
    expect(drawer.hasActiveImage).toBe(true);
  });

  // --- themes ---

  it('returns theme list from themeStore', () => {
    const themes = drawer.themes;
    expect(themes).toHaveLength(5);
    expect(themes[0].id).toBe('classic');
    expect(themes[4].id).toBe('noir');
    expect(themeMock.getThemeList).toHaveBeenCalled();
  });

  // --- activeThemeId ---

  it('returns activeId from themeStore', () => {
    themeMock.activeId = 'amber';
    expect(drawer.activeThemeId).toBe('amber');
  });

  // --- textSize ---

  it('returns textSize from mobilePrefs', () => {
    prefsMock.textSize = 'lg';
    expect(drawer.textSize).toBe('lg');
  });

  // --- openHelp ---

  it('sets showHelp on game session store', () => {
    drawer.openHelp();
    expect(storeMock.showHelp).toBe(true);
  });

  // --- openZoom ---

  it('sets showZoomModal on game session store', () => {
    drawer.openZoom();
    expect(storeMock.showZoomModal).toBe(true);
  });

  // --- changeTheme ---

  it('calls themeStore.setTheme and syncs game store for non-amber theme', () => {
    themeMock.getActiveTheme.mockReturnValue({ id: 'ice', name: 'Ice', colors: {} });
    drawer.changeTheme('ice');
    expect(themeMock.setTheme).toHaveBeenCalledWith('ice');
    expect(storeMock.setTheme).toHaveBeenCalledWith('matrix', false);
  });

  it('calls themeStore.setTheme and syncs game store for amber theme', () => {
    themeMock.getActiveTheme.mockReturnValue({ id: 'amber', name: 'Amber', colors: {} });
    drawer.changeTheme('amber');
    expect(themeMock.setTheme).toHaveBeenCalledWith('amber');
    expect(storeMock.setTheme).toHaveBeenCalledWith('amber', false);
  });

  // --- changeTextSize ---

  it('calls mobilePrefs.setTextSize', () => {
    drawer.changeTextSize('lg');
    expect(prefsMock.setTextSize).toHaveBeenCalledWith('lg');
  });

  it('works for all valid sizes', () => {
    for (const size of ['sm', 'base', 'lg'] as const) {
      drawer.changeTextSize(size);
      expect(prefsMock.setTextSize).toHaveBeenCalledWith(size);
    }
  });

  // --- quit ---

  it('submits quit command to game session store', () => {
    drawer.quit();
    expect(storeMock.submitInput).toHaveBeenCalledWith('quit');
  });
});
