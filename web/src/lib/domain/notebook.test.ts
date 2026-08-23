import { describe, expect, it } from 'vitest';
import {
  NOTEBOOK_SECTIONS,
  buildPeopleView,
  buildPlacesView,
  groupCluesByOrigin,
  matchesLocation,
  nextSection,
  sectionAtIndex,
} from './notebook';
import type { DiscoveredClue, GameState } from '../types/game';

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    mystery_summary: 'Someone took the pie.',
    premise: 'A pie went missing.',
    locations: [
      { id: 'loc-kitchen', name: 'Kitchen', summary: 'Warm and floury.' },
      { id: 'loc-garden', name: 'Garden', summary: null },
      { id: 'loc-barn', name: 'Barn' },
    ],
    characters: [
      {
        id: 'char-rosie',
        first_name: 'Rosie',
        last_name: 'Jones',
        location_name: 'Kitchen',
        sex: 'female',
        summary: 'The baker.',
      },
      {
        id: 'char-bob',
        first_name: 'Bob',
        last_name: 'Smith',
        location_name: 'loc-garden',
        sex: 'male',
      },
    ],
    discovered_clues: [],
    time_remaining: 10,
    location: 'Kitchen',
    mode: 'explore',
    current_talk_character: null,
    history: [],
    ...overrides,
  };
}

function locationClue(id: string, text: string, locationId: string, locationName: string): DiscoveredClue {
  return {
    id,
    text,
    source: 'search',
    origin: { kind: 'location', location_id: locationId, location_name: locationName },
    discovered_at: null,
    off_script: false,
  };
}

function characterClue(id: string, text: string, characterId: string, characterName: string): DiscoveredClue {
  return {
    id,
    text,
    source: 'talk',
    origin: { kind: 'character', character_id: characterId, character_name: characterName },
    discovered_at: null,
    off_script: false,
  };
}

describe('section navigation', () => {
  it('wraps forwards past the last section', () => {
    expect(nextSection('clues', 1)).toBe('story');
  });

  it('wraps backwards past the first section', () => {
    expect(nextSection('story', -1)).toBe('clues');
  });

  it('moves between adjacent sections', () => {
    expect(nextSection('story', 1)).toBe('places');
    expect(nextSection('people', -1)).toBe('places');
  });

  it('maps the number keys to sections in strip order', () => {
    expect(sectionAtIndex(1)).toBe('story');
    expect(sectionAtIndex(4)).toBe('clues');
  });

  it('returns null for a number outside the strip', () => {
    expect(sectionAtIndex(0)).toBeNull();
    expect(sectionAtIndex(5)).toBeNull();
  });

  it('exposes exactly four sections', () => {
    expect(NOTEBOOK_SECTIONS.map((section) => section.id)).toEqual([
      'story',
      'places',
      'people',
      'clues',
    ]);
  });
});

describe('matchesLocation', () => {
  const kitchen = { id: 'loc-kitchen', name: 'Kitchen' };

  it('matches by id and by display name', () => {
    expect(matchesLocation('loc-kitchen', kitchen)).toBe(true);
    expect(matchesLocation('Kitchen', kitchen)).toBe(true);
  });

  it('ignores casing and surrounding whitespace', () => {
    expect(matchesLocation('  KITCHEN  ', kitchen)).toBe(true);
  });

  it('rejects a different place and an empty value', () => {
    expect(matchesLocation('Garden', kitchen)).toBe(false);
    expect(matchesLocation('', kitchen)).toBe(false);
    expect(matchesLocation(null, kitchen)).toBe(false);
  });
});

describe('buildPlacesView', () => {
  it('marks the current location when state.location is a display name', () => {
    const places = buildPlacesView(makeState({ location: 'Kitchen' }));
    expect(places.find((place) => place.id === 'loc-kitchen')?.isCurrent).toBe(true);
    expect(places.find((place) => place.id === 'loc-garden')?.isCurrent).toBe(false);
  });

  it('marks the current location when state.location is an id', () => {
    const places = buildPlacesView(makeState({ location: 'loc-barn' }));
    expect(places.find((place) => place.id === 'loc-barn')?.isCurrent).toBe(true);
  });

  it('lists who is at each place regardless of how location_name is spelled', () => {
    const places = buildPlacesView(makeState());
    expect(places.find((place) => place.id === 'loc-kitchen')?.people).toEqual(['Rosie Jones']);
    // Bob's location_name is an id rather than a name.
    expect(places.find((place) => place.id === 'loc-garden')?.people).toEqual(['Bob Smith']);
  });

  it('reports an empty roster for a place with no one in it', () => {
    const places = buildPlacesView(makeState());
    expect(places.find((place) => place.id === 'loc-barn')?.people).toEqual([]);
  });

  it('returns nothing without a state', () => {
    expect(buildPlacesView(null)).toEqual([]);
  });
});

describe('buildPeopleView', () => {
  it('resolves each person location to its display name', () => {
    const people = buildPeopleView(makeState());
    expect(people.find((person) => person.id === 'char-bob')?.locationLabel).toBe('Garden');
  });

  it('falls back to the raw value for an unknown location', () => {
    const state = makeState();
    state.characters[1].location_name = 'The Old Mill';
    const people = buildPeopleView(state);
    expect(people.find((person) => person.id === 'char-bob')?.locationLabel).toBe('The Old Mill');
  });

  it('flags who is standing with the player', () => {
    const people = buildPeopleView(makeState({ location: 'loc-kitchen' }));
    expect(people.find((person) => person.id === 'char-rosie')?.isHere).toBe(true);
    expect(people.find((person) => person.id === 'char-bob')?.isHere).toBe(false);
  });

  it('returns nothing without a state', () => {
    expect(buildPeopleView(null)).toEqual([]);
  });
});

describe('groupCluesByOrigin', () => {
  it('returns nothing for an empty clue list', () => {
    expect(groupCluesByOrigin([])).toEqual([]);
  });

  it('puts places before people and groups by origin entity', () => {
    const buckets = groupCluesByOrigin([
      characterClue('c1', 'She saw a shadow.', 'char-rosie', 'Rosie Jones'),
      locationClue('c2', 'Crumbs lead to the pantry.', 'loc-kitchen', 'Kitchen'),
    ]);

    expect(buckets.map((bucket) => bucket.label)).toEqual(['FOUND AT PLACES', 'TOLD BY PEOPLE']);
    expect(buckets[0].groups[0].label).toBe('Kitchen');
    expect(buckets[1].groups[0].label).toBe('Rosie Jones');
  });

  it('orders groups by first discovery and clues by discovery within a group', () => {
    const buckets = groupCluesByOrigin([
      locationClue('c1', 'First in the garden.', 'loc-garden', 'Garden'),
      locationClue('c2', 'First in the kitchen.', 'loc-kitchen', 'Kitchen'),
      locationClue('c3', 'Second in the garden.', 'loc-garden', 'Garden'),
    ]);

    const places = buckets[0].groups;
    expect(places.map((group) => group.label)).toEqual(['Garden', 'Kitchen']);
    expect(places[0].clues.map((clue) => clue.id)).toEqual(['c1', 'c3']);
    expect(places[0].count).toBe(2);
    expect(places[1].count).toBe(1);
  });

  it('keeps a clue whose origin entity is unknown under its recorded name', () => {
    const buckets = groupCluesByOrigin([
      locationClue('c1', 'Found somewhere odd.', 'loc-nowhere', 'The Old Mill'),
    ]);
    expect(buckets[0].groups[0].label).toBe('The Old Mill');
  });

  it('groups by name when the origin carries no id', () => {
    const buckets = groupCluesByOrigin([
      locationClue('c1', 'One.', '', 'Kitchen'),
      locationClue('c2', 'Two.', '', 'Kitchen'),
    ]);
    expect(buckets[0].groups).toHaveLength(1);
    expect(buckets[0].groups[0].count).toBe(2);
  });

  it('creates no group for a place where nothing was found', () => {
    const buckets = groupCluesByOrigin([
      locationClue('c1', 'Crumbs.', 'loc-kitchen', 'Kitchen'),
    ]);
    expect(buckets[0].groups.map((group) => group.label)).toEqual(['Kitchen']);
  });

  it('preserves the off_script flag', () => {
    const lucky = { ...locationClue('c1', 'A lucky find.', 'loc-kitchen', 'Kitchen'), off_script: true };
    const buckets = groupCluesByOrigin([lucky]);
    expect(buckets[0].groups[0].clues[0].off_script).toBe(true);
  });

  it('never derives a group label from reasoning-path data on the clue', () => {
    const spoiler = {
      ...locationClue('c1', 'Crumbs.', 'loc-kitchen', 'Kitchen'),
      threads: [{ kind: 'red_herring', label: 'Red herring: the open window' }],
    } as DiscoveredClue;

    const labels = groupCluesByOrigin([spoiler]).flatMap((bucket) => [
      bucket.label,
      ...bucket.groups.map((group) => group.label),
    ]);

    expect(labels.join(' ')).not.toMatch(/red herring|main solution|ruling out/i);
  });
});
