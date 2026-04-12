import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeMock = vi.hoisted(() => ({
  loadBlueprints: vi.fn(),
  loadSessionCatalog: vi.fn(),
  startGame: vi.fn(),
  status: 'idle' as string,
  error: null as string | null,
  blueprints: [] as Array<{ id: string }>,
  sessionCatalog: {
    in_progress: [],
    completed: [],
    counts: { in_progress: 0, completed: 0 },
  },
}));

vi.mock('./store.svelte', () => ({
  gameSessionStore: storeMock,
}));

import { MobileHomeState } from './mobile-home.svelte';

describe('MobileHomeState', () => {
  let state: MobileHomeState;

  beforeEach(() => {
    state = new MobileHomeState();
    storeMock.status = 'idle';
    storeMock.error = null;
    storeMock.blueprints = [];
    storeMock.sessionCatalog = {
      in_progress: [],
      completed: [],
      counts: { in_progress: 0, completed: 0 },
    };
    storeMock.loadBlueprints.mockReset();
    storeMock.startGame.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Initial state ---

  it('starts in menu view', () => {
    expect(state.view).toBe('menu');
    expect(state.startingBlueprintId).toBeNull();
  });

  // --- Derived counts and disabled states ---

  it('hasInProgress is false when count is 0', () => {
    expect(state.hasInProgress).toBe(false);
    expect(state.inProgressCount).toBe(0);
  });

  it('hasInProgress is true when count > 0', () => {
    storeMock.sessionCatalog.counts.in_progress = 3;
    expect(state.hasInProgress).toBe(true);
    expect(state.inProgressCount).toBe(3);
  });

  it('hasCompleted is false when count is 0', () => {
    expect(state.hasCompleted).toBe(false);
    expect(state.completedCount).toBe(0);
  });

  it('hasCompleted is true when count > 0', () => {
    storeMock.sessionCatalog.counts.completed = 5;
    expect(state.hasCompleted).toBe(true);
    expect(state.completedCount).toBe(5);
  });

  // --- isLoadingBlueprints ---

  it('isLoadingBlueprints is true when status is loading and blueprints empty', () => {
    storeMock.status = 'loading';
    storeMock.blueprints = [];
    expect(state.isLoadingBlueprints).toBe(true);
  });

  it('isLoadingBlueprints is false when blueprints already loaded', () => {
    storeMock.status = 'loading';
    storeMock.blueprints = [{ id: 'bp-1' }];
    expect(state.isLoadingBlueprints).toBe(false);
  });

  it('isLoadingBlueprints is false when status is idle', () => {
    storeMock.status = 'idle';
    storeMock.blueprints = [];
    expect(state.isLoadingBlueprints).toBe(false);
  });

  // --- enterNewGameFlow ---

  it('switches to new-game view', async () => {
    storeMock.loadBlueprints.mockResolvedValue(undefined);
    await state.enterNewGameFlow();
    expect(state.view).toBe('new-game');
  });

  it('loads blueprints when none are loaded and store is idle', async () => {
    storeMock.loadBlueprints.mockResolvedValue(undefined);
    await state.enterNewGameFlow();
    expect(storeMock.loadBlueprints).toHaveBeenCalledOnce();
  });

  it('skips loading blueprints when already loaded', async () => {
    storeMock.blueprints = [{ id: 'bp-1' }];
    await state.enterNewGameFlow();
    expect(storeMock.loadBlueprints).not.toHaveBeenCalled();
  });

  it('skips loading blueprints when store is not idle', async () => {
    storeMock.status = 'loading';
    await state.enterNewGameFlow();
    expect(storeMock.loadBlueprints).not.toHaveBeenCalled();
  });

  // --- backToMenu ---

  it('returns to menu view and clears error', () => {
    state.view = 'new-game';
    storeMock.error = 'some error';
    state.backToMenu();
    expect(state.view).toBe('menu');
    expect(storeMock.error).toBeNull();
  });

  // --- startBlueprint ---

  it('calls startGame and returns true on success', async () => {
    storeMock.startGame.mockImplementation(async () => {
      storeMock.status = 'active';
    });
    const result = await state.startBlueprint('bp-1');
    expect(storeMock.startGame).toHaveBeenCalledWith('bp-1');
    expect(result).toBe(true);
    expect(state.startingBlueprintId).toBeNull();
  });

  it('returns false when startGame does not reach active status', async () => {
    storeMock.startGame.mockImplementation(async () => {
      storeMock.status = 'error';
    });
    const result = await state.startBlueprint('bp-1');
    expect(result).toBe(false);
    expect(state.startingBlueprintId).toBeNull();
  });

  it('sets startingBlueprintId during startGame call', async () => {
    let capturedId: string | null = null;
    storeMock.startGame.mockImplementation(async () => {
      capturedId = state.startingBlueprintId;
      storeMock.status = 'active';
    });
    await state.startBlueprint('bp-42');
    expect(capturedId).toBe('bp-42');
    // Cleared after completion
    expect(state.startingBlueprintId).toBeNull();
  });
});
