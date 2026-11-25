import { describe, expect, it, vi } from 'vitest';
import { beginInvestigation, returnToMysteryList, type PromptStore } from './session-prompts';

function fakeStore(overrides: Partial<PromptStore> = {}): PromptStore {
  return {
    status: 'active',
    enterStartingLocation: vi.fn(async () => {}),
    loadSessionCatalog: vi.fn(async () => {}),
    clearSessionForMysteryList: vi.fn(),
    ...overrides,
  };
}

describe('beginInvestigation', () => {
  it('steps into the starting location', async () => {
    const store = fakeStore();
    await beginInvestigation(store);
    expect(store.enterStartingLocation).toHaveBeenCalledTimes(1);
  });

  it('does nothing while a request is in flight', async () => {
    const store = fakeStore({ status: 'loading' });
    await beginInvestigation(store);
    expect(store.enterStartingLocation).not.toHaveBeenCalled();
  });
});

describe('returnToMysteryList', () => {
  it('refreshes the catalog, clears the session and goes to the list', async () => {
    const calls: string[] = [];
    const store = fakeStore({
      loadSessionCatalog: vi.fn(async () => void calls.push('load')),
      clearSessionForMysteryList: vi.fn(() => void calls.push('clear')),
    });
    const navigate = vi.fn(async (path: string) => void calls.push(`go ${path}`));

    await returnToMysteryList(store, navigate);

    expect(calls).toEqual(['load', 'clear', 'go /']);
  });

  it('still leaves when the catalog refresh fails, and reports the failure', async () => {
    const store = fakeStore({
      loadSessionCatalog: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const navigate = vi.fn(async () => {});

    await expect(returnToMysteryList(store, navigate)).rejects.toThrow('offline');
    expect(store.clearSessionForMysteryList).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('runs once when a key and a tap arrive together', async () => {
    const store = fakeStore();
    const navigate = vi.fn(async () => {});

    await Promise.all([
      returnToMysteryList(store, navigate),
      returnToMysteryList(store, navigate),
    ]);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(store.clearSessionForMysteryList).toHaveBeenCalledTimes(1);
  });

  it('can run again after it finished', async () => {
    const store = fakeStore();
    const navigate = vi.fn(async () => {});

    await returnToMysteryList(store, navigate);
    await returnToMysteryList(store, navigate);

    expect(navigate).toHaveBeenCalledTimes(2);
  });
});
