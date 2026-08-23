import type { DiscoveredClue, GameState } from '../types/game';

export type NotebookSection = 'story' | 'places' | 'people' | 'clues';

/**
 * Ordered once, here. The array order drives the tab strip, the wrap-around
 * arrow navigation, and the 1-4 number shortcuts, so section order can never
 * disagree with itself.
 */
export const NOTEBOOK_SECTIONS: readonly { id: NotebookSection; label: string }[] = [
  { id: 'story', label: 'STORY' },
  { id: 'places', label: 'PLACES' },
  { id: 'people', label: 'PEOPLE' },
  { id: 'clues', label: 'CLUES' },
] as const;

export const DEFAULT_NOTEBOOK_SECTION: NotebookSection = 'story';

export function nextSection(current: NotebookSection, delta: number): NotebookSection {
  const count = NOTEBOOK_SECTIONS.length;
  const index = NOTEBOOK_SECTIONS.findIndex((section) => section.id === current);
  const from = index === -1 ? 0 : index;
  const target = (((from + delta) % count) + count) % count;
  return NOTEBOOK_SECTIONS[target].id;
}

/** 1-based, matching the number keys the player presses. */
export function sectionAtIndex(index: number): NotebookSection | null {
  return NOTEBOOK_SECTIONS[index - 1]?.id ?? null;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * `character.location_name` and `state.location` are populated inconsistently
 * across the backend — sometimes a location id, sometimes its display name.
 * Every comparison in the notebook goes through here so all of them agree.
 */
export function matchesLocation(value: string | null | undefined, location: { id: string; name: string }): boolean {
  const normalized = normalize(value);
  if (normalized === '') {
    return false;
  }
  return normalized === normalize(location.id) || normalized === normalize(location.name);
}

export interface PlaceEntry {
  id: string;
  name: string;
  summary: string | null;
  isCurrent: boolean;
  people: string[];
}

function displayNameOf(character: GameState['characters'][number]): string {
  return `${character.first_name} ${character.last_name}`.trim();
}

/**
 * Reproduces both halves of the retired `locations` command output — every
 * place and who is standing at it — plus a marker for where the player is now.
 */
export function buildPlacesView(state: GameState | null): PlaceEntry[] {
  if (!state) {
    return [];
  }

  return state.locations.map((location) => ({
    id: location.id,
    name: location.name,
    summary: location.summary ?? null,
    isCurrent: matchesLocation(state.location, location),
    people: state.characters
      .filter((character) => matchesLocation(character.location_name, location))
      .map(displayNameOf),
  }));
}

export interface PersonEntry {
  id: string;
  displayName: string;
  summary: string | null;
  locationLabel: string | null;
  isHere: boolean;
}

/**
 * A superset of the retired `characters` command: every person, not just the
 * ones in the room, each tagged with where they are and whether that is here.
 */
export function buildPeopleView(state: GameState | null): PersonEntry[] {
  if (!state) {
    return [];
  }

  const currentLocation = state.locations.find((location) => matchesLocation(state.location, location));

  return state.characters.map((character) => {
    const known = state.locations.find((location) => matchesLocation(character.location_name, location));
    const rawLabel = character.location_name?.trim() ?? '';

    return {
      id: character.id,
      displayName: displayNameOf(character),
      summary: character.summary ?? null,
      // Fall back to the raw value so a character parked somewhere the state
      // does not list still reports a location instead of vanishing.
      locationLabel: known?.name ?? (rawLabel === '' ? null : rawLabel),
      isHere: currentLocation ? matchesLocation(character.location_name, currentLocation) : false,
    };
  });
}

export type ClueBucketKind = 'places' | 'people' | 'other';

export interface ClueGroup {
  key: string;
  label: string;
  count: number;
  clues: DiscoveredClue[];
}

export interface ClueBucket {
  bucket: ClueBucketKind;
  label: string;
  groups: ClueGroup[];
}

const BUCKET_LABELS: Record<ClueBucketKind, string> = {
  places: 'FOUND AT PLACES',
  people: 'TOLD BY PEOPLE',
  other: 'ELSEWHERE',
};

const BUCKET_ORDER: ClueBucketKind[] = ['places', 'people', 'other'];

// Group discovered clues by where the investigator found them. Grouping must
// stay derivable by the player: an earlier version grouped by mini-mystery
// thread, which labelled clues "Main solution" / "Red herring: <payoff>" and
// handed the child the answer. Origin is something they already know.
function bucketAndGroupOf(clue: DiscoveredClue): { bucket: ClueBucketKind; key: string; label: string } {
  if (clue.origin.kind === 'location') {
    const name = clue.origin.location_name;
    return { bucket: 'places', key: clue.origin.location_id || normalize(name), label: name };
  }
  if (clue.origin.kind === 'character') {
    const name = clue.origin.character_name;
    return { bucket: 'people', key: clue.origin.character_id || normalize(name), label: name };
  }
  return { bucket: 'other', key: 'other', label: 'Elsewhere' };
}

/**
 * Grouping is driven by the clue list itself, never by `state.locations` /
 * `state.characters`. That keeps a clue whose origin entity is unknown visible
 * under its own recorded name, and stops a place with no clues from rendering
 * an empty heading.
 */
export function groupCluesByOrigin(clues: DiscoveredClue[]): ClueBucket[] {
  const buckets = new Map<ClueBucketKind, Map<string, ClueGroup>>();

  for (const clue of clues) {
    const { bucket, key, label } = bucketAndGroupOf(clue);
    const groups = buckets.get(bucket) ?? new Map<string, ClueGroup>();
    const group = groups.get(key) ?? { key, label, count: 0, clues: [] };
    // Insertion order follows discovery order, so each group reads as a record
    // of the investigation rather than a re-sorted index.
    group.clues.push(clue);
    group.count = group.clues.length;
    groups.set(key, group);
    buckets.set(bucket, groups);
  }

  return BUCKET_ORDER.filter((bucket) => buckets.has(bucket)).map((bucket) => ({
    bucket,
    label: BUCKET_LABELS[bucket],
    groups: [...buckets.get(bucket)!.values()],
  }));
}
