export type LandingChoice = 'new-game' | 'in-progress' | 'completed';

export interface LandingCounts {
  in_progress: number;
  completed: number;
}

export interface LandingRow {
  number: number;
  choice: LandingChoice;
  label: string;
  /** The session count shown beside the row; null where the row has none. */
  count: number | null;
  enabled: boolean;
}

/** The numbered rows of the landing menu. A list row is enabled only when it has sessions. */
export function landingRows(counts: LandingCounts): LandingRow[] {
  return [
    { number: 1, choice: 'new-game', label: 'Start a new game', count: null, enabled: true },
    {
      number: 2,
      choice: 'in-progress',
      label: 'View in-progress games',
      count: counts.in_progress,
      enabled: counts.in_progress > 0,
    },
    {
      number: 3,
      choice: 'completed',
      label: 'View completed games',
      count: counts.completed,
      enabled: counts.completed > 0,
    },
  ];
}

/** What a key picks on the landing menu, or null: the same answer a tap on that row gives. */
export function pickLandingChoice(key: string, counts: LandingCounts): LandingChoice | null {
  const row = landingRows(counts).find((candidate) => String(candidate.number) === key);
  return row?.enabled ? row.choice : null;
}

/** The item a number key picks from a numbered list, or null when the key names none. */
export function pickNumbered<T>(key: string, items: readonly T[]): T | null {
  const index = Number.parseInt(key, 10);
  if (!Number.isFinite(index) || index < 1 || index > items.length) {
    return null;
  }

  return items[index - 1];
}
