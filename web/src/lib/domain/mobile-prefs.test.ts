import { describe, expect, it, beforeEach, vi } from 'vitest';
import { mobilePrefs } from './mobile-prefs.svelte';

let storage: Record<string, string>;

function mockLocalStorage() {
  storage = {};
  vi.stubGlobal('window', {
    localStorage: {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage[key] = value;
      }),
    },
  });
}

beforeEach(() => {
  mobilePrefs.textSize = 'base';
  storage = {};
});

describe('MobilePrefsStore', () => {
  it('defaults textSize to base', () => {
    expect(mobilePrefs.textSize).toBe('base');
  });

  it('init() loads saved value from localStorage', () => {
    mockLocalStorage();
    storage['mystery-game-text-size'] = 'lg';
    mobilePrefs.init();
    expect(mobilePrefs.textSize).toBe('lg');
  });

  it('init() ignores invalid localStorage values', () => {
    mockLocalStorage();
    storage['mystery-game-text-size'] = 'xxxl';
    mobilePrefs.init();
    expect(mobilePrefs.textSize).toBe('base');
  });

  it('init() ignores missing localStorage values', () => {
    mockLocalStorage();
    mobilePrefs.init();
    expect(mobilePrefs.textSize).toBe('base');
  });

  it('init() no-ops when window is undefined (SSR)', () => {
    vi.stubGlobal('window', undefined);
    mobilePrefs.init();
    expect(mobilePrefs.textSize).toBe('base');
  });

  it('setTextSize() updates state and persists to localStorage', () => {
    mockLocalStorage();
    mobilePrefs.setTextSize('sm');
    expect(mobilePrefs.textSize).toBe('sm');
    expect(window.localStorage.setItem).toHaveBeenCalledWith('mystery-game-text-size', 'sm');
  });

  it('setTextSize() works for all valid sizes', () => {
    mockLocalStorage();
    for (const size of ['sm', 'base', 'lg'] as const) {
      mobilePrefs.setTextSize(size);
      expect(mobilePrefs.textSize).toBe(size);
    }
  });
});
