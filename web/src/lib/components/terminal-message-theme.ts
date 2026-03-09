import type { SpeakerKind } from '$lib/types/game';

export type TerminalThemeName = 'matrix' | 'amber';

export interface SpeakerThemeClasses {
  label: string;
  body: string;
}

type ThemeSpeakerMap = Record<TerminalThemeName, Record<SpeakerKind, SpeakerThemeClasses>>;

export const DEFAULT_TERMINAL_THEME: TerminalThemeName = 'matrix';

const THEME_SPEAKER_CLASS_MAP: ThemeSpeakerMap = {
  matrix: {
    investigator: {
      label: 'speaker-label-investigator matrix-label',
      body: 'speaker-body-investigator matrix-body',
    },
    narrator: {
      label: 'speaker-label-narrator matrix-label',
      body: 'speaker-body-narrator matrix-body',
    },
    character: {
      label: 'speaker-label-character matrix-label',
      body: 'speaker-body-character matrix-body speaker-character-generic',
    },
    system: {
      label: 'speaker-label-system matrix-label',
      body: 'speaker-body-system matrix-body',
    },
  },
  amber: {
    investigator: {
      label: 'speaker-label-investigator amber-label',
      body: 'speaker-body-investigator amber-body',
    },
    narrator: {
      label: 'speaker-label-narrator amber-label',
      body: 'speaker-body-narrator amber-body',
    },
    character: {
      label: 'speaker-label-character amber-label',
      body: 'speaker-body-character amber-body speaker-character-generic',
    },
    system: {
      label: 'speaker-label-system amber-label',
      body: 'speaker-body-system amber-body',
    },
  },
};

export function readTerminalTheme(theme: unknown): TerminalThemeName {
  return theme === 'amber' ? 'amber' : DEFAULT_TERMINAL_THEME;
}

export function getSpeakerThemeClasses(
  theme: unknown,
  kind: SpeakerKind,
): SpeakerThemeClasses {
  const activeTheme = readTerminalTheme(theme);
  return THEME_SPEAKER_CLASS_MAP[activeTheme][kind];
}
