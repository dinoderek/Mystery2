import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState, HistoryEntry, StoryImageState } from '../types/game';

const storeMock = vi.hoisted(() => ({
  submitInput: vi.fn(),
  loadSessionCatalog: vi.fn(),
  clearSessionForMysteryList: vi.fn(),
  status: 'active' as string,
  game_id: 'game-1' as string | null,
  blueprint_id: 'bp-1' as string | null,
  state: null as GameState | null,
  blueprints: [] as Array<{ id: string; title: string }>,
  activeStoryImage: null as StoryImageState | null,
  showHelp: false,
  showZoomModal: false,
  accusationOutcome: null as 'win' | 'lose' | null,
  awaitingReturnToList: false,
  viewerMode: 'interactive' as string,
  theme: 'matrix' as string,
}));

vi.mock('./store.svelte', () => ({
  gameSessionStore: storeMock,
}));

import { MobileSessionState } from './mobile-session.svelte';

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
    ],
    time_remaining: 10,
    location: 'library',
    mode: 'explore',
    current_talk_character: null,
    history: [],
    ...overrides,
  };
}

function makeHistoryEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    sequence: 1,
    event_type: 'narration',
    text: 'Something happened.',
    speaker: { kind: 'narrator', key: 'narrator', label: 'NARRATOR' },
    image_id: null,
    ...overrides,
  };
}

describe('MobileSessionState', () => {
  let state: MobileSessionState;

  beforeEach(() => {
    state = new MobileSessionState();
    storeMock.status = 'active';
    storeMock.game_id = 'game-1';
    storeMock.blueprint_id = 'bp-1';
    storeMock.state = makeState();
    storeMock.blueprints = [{ id: 'bp-1', title: 'The Missing Key' }];
    storeMock.activeStoryImage = null;
    storeMock.showHelp = false;
    storeMock.showZoomModal = false;
    storeMock.accusationOutcome = null;
    storeMock.awaitingReturnToList = false;
    storeMock.viewerMode = 'interactive';
    storeMock.submitInput.mockReset();
    storeMock.loadSessionCatalog.mockReset();
    storeMock.clearSessionForMysteryList.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Initial state ---

  describe('initial state', () => {
    it('starts in reading mode', () => {
      expect(state.sessionMode).toBe('reading');
    });

    it('drawer is closed', () => {
      expect(state.drawerOpen).toBe(false);
    });

    it('image viewer is hidden', () => {
      expect(state.showImageViewer).toBe(false);
      expect(state.activeViewerImageId).toBeNull();
    });

    it('input draft is empty', () => {
      expect(state.inputDraft).toBe('');
    });

    it('input prefill is empty', () => {
      expect(state.inputPrefill).toBe('');
    });
  });

  // --- isActive ---

  describe('isActive', () => {
    it('returns true when store is active with game_id', () => {
      expect(state.isActive).toBe(true);
    });

    it('returns false when status is idle', () => {
      storeMock.status = 'idle';
      expect(state.isActive).toBe(false);
    });

    it('returns false when game_id is null', () => {
      storeMock.game_id = null;
      expect(state.isActive).toBe(false);
    });
  });

  // --- title ---

  describe('title', () => {
    it('returns blueprint title when found', () => {
      expect(state.title).toBe('The Missing Key');
    });

    it('returns "Mystery" when blueprint_id is null', () => {
      storeMock.blueprint_id = null;
      expect(state.title).toBe('Mystery');
    });

    it('returns "Mystery" when blueprint not found in list', () => {
      storeMock.blueprint_id = 'bp-unknown';
      expect(state.title).toBe('Mystery');
    });
  });

  // --- turnsRemaining ---

  describe('turnsRemaining', () => {
    it('returns time_remaining from state', () => {
      expect(state.turnsRemaining).toBe(10);
    });

    it('returns 0 when state is null', () => {
      storeMock.state = null;
      expect(state.turnsRemaining).toBe(0);
    });
  });

  // --- isLoading ---

  describe('isLoading', () => {
    it('returns true when store status is loading', () => {
      storeMock.status = 'loading';
      expect(state.isLoading).toBe(true);
    });

    it('returns false when store status is active', () => {
      expect(state.isLoading).toBe(false);
    });
  });

  // --- isReadOnly ---

  describe('isReadOnly', () => {
    it('returns false in interactive mode', () => {
      expect(state.isReadOnly).toBe(false);
    });

    it('returns true in read_only_completed mode', () => {
      storeMock.viewerMode = 'read_only_completed';
      expect(state.isReadOnly).toBe(true);
    });
  });

  // --- isEndState ---

  describe('isEndState', () => {
    it('returns false during normal gameplay', () => {
      expect(state.isEndState).toBe(false);
    });

    it('returns true when awaitingReturnToList', () => {
      storeMock.awaitingReturnToList = true;
      expect(state.isEndState).toBe(true);
    });

    it('returns true when read_only_completed', () => {
      storeMock.viewerMode = 'read_only_completed';
      expect(state.isEndState).toBe(true);
    });
  });

  // --- endStateLabel ---

  describe('endStateLabel', () => {
    it('returns CASE SOLVED on win', () => {
      storeMock.accusationOutcome = 'win';
      expect(state.endStateLabel).toBe('CASE SOLVED');
    });

    it('returns CASE UNSOLVED on lose', () => {
      storeMock.accusationOutcome = 'lose';
      expect(state.endStateLabel).toBe('CASE UNSOLVED');
    });

    it('returns SESSION ENDED for quit', () => {
      storeMock.accusationOutcome = null;
      expect(state.endStateLabel).toBe('SESSION ENDED');
    });
  });

  // --- inputPlaceholder ---

  describe('inputPlaceholder', () => {
    it('returns explore placeholder by default', () => {
      expect(state.inputPlaceholder).toBe('Type a command...');
    });

    it('returns talk placeholder in talk mode', () => {
      storeMock.state = makeState({ mode: 'talk' });
      expect(state.inputPlaceholder).toBe('Ask a question...');
    });

    it('returns accuse placeholder in accuse mode', () => {
      storeMock.state = makeState({ mode: 'accuse' });
      expect(state.inputPlaceholder).toBe('State your reasoning...');
    });

    it('returns explore placeholder when state is null', () => {
      storeMock.state = null;
      expect(state.inputPlaceholder).toBe('Type a command...');
    });
  });

  // --- effectivePrefill ---

  describe('effectivePrefill', () => {
    it('returns undefined when both prefill and draft are empty', () => {
      expect(state.effectivePrefill).toBeUndefined();
    });

    it('returns inputPrefill when set', () => {
      state.inputPrefill = 'accuse ';
      expect(state.effectivePrefill).toBe('accuse ');
    });

    it('returns inputDraft when prefill is empty', () => {
      state.inputDraft = 'go to lib';
      expect(state.effectivePrefill).toBe('go to lib');
    });

    it('prefers inputPrefill over inputDraft', () => {
      state.inputPrefill = 'accuse ';
      state.inputDraft = 'go to lib';
      expect(state.effectivePrefill).toBe('accuse ');
    });
  });

  // --- lastInteractionGroup ---

  describe('lastInteractionGroup', () => {
    it('returns empty array when no history', () => {
      expect(state.lastInteractionGroup).toEqual([]);
    });

    it('returns empty array when state is null', () => {
      storeMock.state = null;
      expect(state.lastInteractionGroup).toEqual([]);
    });

    it('returns entries with the highest sequence number', () => {
      storeMock.state = makeState({
        history: [
          makeHistoryEntry({ sequence: 1, text: 'First' }),
          makeHistoryEntry({ sequence: 2, text: 'Second-a' }),
          makeHistoryEntry({ sequence: 2, text: 'Second-b' }),
        ],
      });
      const group = state.lastInteractionGroup;
      expect(group).toHaveLength(2);
      expect(group[0].text).toBe('Second-a');
      expect(group[1].text).toBe('Second-b');
    });

    it('returns single entry when only one at max sequence', () => {
      storeMock.state = makeState({
        history: [
          makeHistoryEntry({ sequence: 1, text: 'First' }),
          makeHistoryEntry({ sequence: 3, text: 'Third' }),
        ],
      });
      const group = state.lastInteractionGroup;
      expect(group).toHaveLength(1);
      expect(group[0].text).toBe('Third');
    });
  });

  // --- Mode switching ---

  describe('mode switching', () => {
    it('switchToInput sets session mode to input', () => {
      state.switchToInput();
      expect(state.sessionMode).toBe('input');
    });

    it('switchToInput clears prefill', () => {
      state.inputPrefill = 'accuse ';
      state.switchToInput();
      expect(state.inputPrefill).toBe('');
    });

    it('switchToInputWithPrefill sets prefill and clears draft', () => {
      state.inputDraft = 'old draft';
      state.switchToInputWithPrefill('accuse ');
      expect(state.sessionMode).toBe('input');
      expect(state.inputPrefill).toBe('accuse ');
      expect(state.inputDraft).toBe('');
    });

    it('switchToReading returns to reading mode', () => {
      state.sessionMode = 'input';
      state.switchToReading();
      expect(state.sessionMode).toBe('reading');
    });

    it('switchToReading clears prefill', () => {
      state.inputPrefill = 'accuse ';
      state.switchToReading();
      expect(state.inputPrefill).toBe('');
    });
  });

  // --- Input handling ---

  describe('handleSend', () => {
    it('calls submitInput and clears draft', () => {
      state.inputDraft = 'some draft';
      state.sessionMode = 'input';
      state.handleSend('search');
      expect(storeMock.submitInput).toHaveBeenCalledWith('search');
      expect(state.inputDraft).toBe('');
      expect(state.inputPrefill).toBe('');
      expect(state.sessionMode).toBe('reading');
    });
  });

  describe('handleCancel', () => {
    it('clears draft and prefill and returns to reading', () => {
      state.inputDraft = 'some draft';
      state.inputPrefill = 'accuse ';
      state.sessionMode = 'input';
      state.handleCancel();
      expect(state.inputDraft).toBe('');
      expect(state.inputPrefill).toBe('');
      expect(state.sessionMode).toBe('reading');
    });
  });

  // --- Drawer ---

  describe('toggleDrawer', () => {
    it('opens drawer when closed', () => {
      state.toggleDrawer();
      expect(state.drawerOpen).toBe(true);
    });

    it('closes drawer when open', () => {
      state.drawerOpen = true;
      state.toggleDrawer();
      expect(state.drawerOpen).toBe(false);
    });
  });

  // --- Image viewer ---

  describe('image viewer', () => {
    it('openImageViewer sets image id and shows viewer', () => {
      state.openImageViewer('img-abc');
      expect(state.showImageViewer).toBe(true);
      expect(state.activeViewerImageId).toBe('img-abc');
    });

    it('closeImageViewer hides viewer and clears image id', () => {
      state.openImageViewer('img-abc');
      state.closeImageViewer();
      expect(state.showImageViewer).toBe(false);
      expect(state.activeViewerImageId).toBeNull();
    });
  });

  // --- End state ---

  describe('handleEndStateTap', () => {
    it('loads session catalog and clears session', async () => {
      storeMock.loadSessionCatalog.mockResolvedValue(undefined);
      await state.handleEndStateTap();
      expect(storeMock.loadSessionCatalog).toHaveBeenCalledWith(true);
      expect(storeMock.clearSessionForMysteryList).toHaveBeenCalledOnce();
    });

    it('clears session even if loadSessionCatalog fails', async () => {
      storeMock.loadSessionCatalog.mockRejectedValue(new Error('network'));
      await state.handleEndStateTap();
      expect(storeMock.clearSessionForMysteryList).toHaveBeenCalledOnce();
    });
  });
});
