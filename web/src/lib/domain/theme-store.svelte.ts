export interface ThemeColors {
  bg: string;
  primary: string;
  bright: string;
  muted: string;
  dim: string;
  dialogue: string;
  error: string;
  warning: string;
  glow: string;
}

export interface Theme {
  id: string;
  name: string;
  colors: ThemeColors;
}

const THEMES: Theme[] = [
  {
    id: 'classic',
    name: 'Classic Green',
    colors: {
      bg: '#000000',
      primary: '#4ade80',
      bright: '#86efac',
      muted: '#22c55e',
      dim: '#16a34a',
      dialogue: '#facc15',
      error: '#f87171',
      warning: '#fcd34d',
      glow: 'rgba(34, 197, 94, 0.3)',
    },
  },
  {
    id: 'amber',
    name: 'Amber',
    colors: {
      bg: '#0a0800',
      primary: '#fbbf24',
      bright: '#fcd34d',
      muted: '#f59e0b',
      dim: '#d97706',
      dialogue: '#a78bfa',
      error: '#f87171',
      warning: '#fdba74',
      glow: 'rgba(245, 158, 11, 0.3)',
    },
  },
  {
    id: 'ice',
    name: 'Ice',
    colors: {
      bg: '#020617',
      primary: '#38bdf8',
      bright: '#7dd3fc',
      muted: '#0ea5e9',
      dim: '#0284c7',
      dialogue: '#c084fc',
      error: '#fb7185',
      warning: '#fdba74',
      glow: 'rgba(14, 165, 233, 0.3)',
    },
  },
  {
    id: 'phosphor',
    name: 'Phosphor',
    colors: {
      bg: '#0a0a0a',
      primary: '#d4f4dd',
      bright: '#ecfdf5',
      muted: '#86efac',
      dim: '#4ade80',
      dialogue: '#fef08a',
      error: '#fca5a5',
      warning: '#fde68a',
      glow: 'rgba(134, 239, 172, 0.4)',
    },
  },
  {
    id: 'noir',
    name: 'Noir',
    colors: {
      bg: '#0a0a0a',
      primary: '#d4d4d4',
      bright: '#f5f5f5',
      muted: '#a3a3a3',
      dim: '#737373',
      dialogue: '#fbbf24',
      error: '#f87171',
      warning: '#d4d4d4',
      glow: 'rgba(163, 163, 163, 0.3)',
    },
  },
];

const STORAGE_KEY = 'mystery-game-theme';
const CSS_PROPERTIES: (keyof ThemeColors)[] = [
  'bg',
  'primary',
  'bright',
  'muted',
  'dim',
  'dialogue',
  'error',
  'warning',
  'glow',
];

function findTheme(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}

function applyThemeToDom(theme: Theme): void {
  const root = document.documentElement;
  for (const prop of CSS_PROPERTIES) {
    root.style.setProperty(`--t-${prop}`, theme.colors[prop]);
  }
}

class ThemeStore {
  activeId = $state('classic');

  init(): void {
    const saved = localStorage.getItem(STORAGE_KEY);
    const theme = saved ? findTheme(saved) : undefined;
    this.activeId = theme ? theme.id : 'classic';
    applyThemeToDom(this.getActiveTheme());
  }

  getThemeList(): Theme[] {
    return THEMES;
  }

  getActiveTheme(): Theme {
    return findTheme(this.activeId) ?? THEMES[0];
  }

  getActiveThemeName(): string {
    return this.getActiveTheme().name;
  }

  setTheme(idOrName: string): boolean {
    const normalized = idOrName.toLowerCase().trim();
    const theme =
      THEMES.find((t) => t.id === normalized) ??
      THEMES.find((t) => t.name.toLowerCase() === normalized);

    if (!theme) {
      return false;
    }

    this.activeId = theme.id;
    applyThemeToDom(theme);
    localStorage.setItem(STORAGE_KEY, theme.id);
    return true;
  }
}

export const themeStore = new ThemeStore();
