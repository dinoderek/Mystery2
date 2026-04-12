const STORAGE_KEY = 'mystery-game-text-size';
const VALID_SIZES = ['sm', 'base', 'lg'] as const;

export type TextSize = (typeof VALID_SIZES)[number];

class MobilePrefsStore {
  textSize: TextSize = $state('base');

  init(): void {
    if (typeof window === 'undefined') return;

    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && VALID_SIZES.includes(saved as TextSize)) {
      this.textSize = saved as TextSize;
    }
  }

  setTextSize(size: TextSize): void {
    this.textSize = size;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, size);
    }
  }
}

export const mobilePrefs = new MobilePrefsStore();
