import { describe, expect, it, beforeEach, vi } from 'vitest';
import { themeStore } from './theme-store.svelte';

const mockStorage = new Map<string, string>();

beforeEach(() => {
  mockStorage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => mockStorage.get(key) ?? null,
    setItem: (key: string, value: string) => mockStorage.set(key, value),
    removeItem: (key: string) => mockStorage.delete(key),
  });

  // Mock document.documentElement.style.setProperty
  vi.stubGlobal('document', {
    documentElement: {
      style: {
        setProperty: vi.fn(),
      },
    },
  });

  // Reset to default
  themeStore.activeId = 'classic';
});

describe('themeStore', () => {
  describe('getThemeList', () => {
    it('returns all available themes', () => {
      const themes = themeStore.getThemeList();
      expect(themes.length).toBeGreaterThanOrEqual(5);
      expect(themes.map((t) => t.id)).toContain('classic');
      expect(themes.map((t) => t.id)).toContain('amber');
      expect(themes.map((t) => t.id)).toContain('ice');
      expect(themes.map((t) => t.id)).toContain('phosphor');
      expect(themes.map((t) => t.id)).toContain('noir');
    });

    it('each theme has all required color properties', () => {
      const requiredKeys = ['bg', 'primary', 'bright', 'muted', 'dim', 'dialogue', 'error', 'warning', 'glow'];
      for (const theme of themeStore.getThemeList()) {
        for (const key of requiredKeys) {
          expect(theme.colors).toHaveProperty(key);
          expect(theme.colors[key as keyof typeof theme.colors]).toBeTruthy();
        }
      }
    });
  });

  describe('getActiveTheme / getActiveThemeName', () => {
    it('defaults to classic', () => {
      expect(themeStore.getActiveTheme().id).toBe('classic');
      expect(themeStore.getActiveThemeName()).toBe('Classic Green');
    });
  });

  describe('setTheme', () => {
    it('switches theme by id', () => {
      const result = themeStore.setTheme('amber');
      expect(result).toBe(true);
      expect(themeStore.activeId).toBe('amber');
      expect(themeStore.getActiveThemeName()).toBe('Amber');
    });

    it('switches theme by name (case-insensitive)', () => {
      const result = themeStore.setTheme('Ice');
      expect(result).toBe(true);
      expect(themeStore.activeId).toBe('ice');
    });

    it('returns false for unknown theme', () => {
      const result = themeStore.setTheme('nonexistent');
      expect(result).toBe(false);
      expect(themeStore.activeId).toBe('classic');
    });

    it('persists to localStorage', () => {
      themeStore.setTheme('noir');
      expect(mockStorage.get('mystery-game-theme')).toBe('noir');
    });

    it('applies CSS custom properties to document', () => {
      themeStore.setTheme('amber');
      const setProperty = document.documentElement.style.setProperty as ReturnType<typeof vi.fn>;
      expect(setProperty).toHaveBeenCalledWith('--t-bg', expect.any(String));
      expect(setProperty).toHaveBeenCalledWith('--t-primary', expect.any(String));
    });
  });

  describe('init', () => {
    it('loads saved theme from localStorage', () => {
      mockStorage.set('mystery-game-theme', 'noir');
      themeStore.init();
      expect(themeStore.activeId).toBe('noir');
    });

    it('falls back to classic for invalid saved theme', () => {
      mockStorage.set('mystery-game-theme', 'deleted-theme');
      themeStore.init();
      expect(themeStore.activeId).toBe('classic');
    });

    it('uses classic when no saved preference', () => {
      themeStore.init();
      expect(themeStore.activeId).toBe('classic');
    });

    it('applies theme to DOM on init', () => {
      themeStore.init();
      const setProperty = document.documentElement.style.setProperty as ReturnType<typeof vi.fn>;
      expect(setProperty).toHaveBeenCalled();
    });
  });
});
