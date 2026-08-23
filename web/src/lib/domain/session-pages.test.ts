import { describe, expect, it } from 'vitest';
import { buildSessionPages, PAGE_OPENING_EVENT_TYPES } from './session-pages';
import { NARRATOR_SPEAKER, INVESTIGATOR_SPEAKER, SYSTEM_SPEAKER } from './speaker';
import type { NarrationEvent, NarrationPart } from '../types/game';

let nextSequence = 1;

function event(
  event_type: string,
  parts: Array<Partial<NarrationPart> & { text: string }>,
  payload?: Record<string, unknown>,
): NarrationEvent {
  return {
    sequence: nextSequence++,
    event_type,
    narration_parts: parts.map((part) => ({
      text: part.text,
      speaker: part.speaker ?? NARRATOR_SPEAKER,
      image_id: part.image_id ?? null,
    })),
    payload,
  };
}

function reset() {
  nextSequence = 1;
}

/** The canonical opening: intro over the cover, then the arrival page. */
function opening(): NarrationEvent[] {
  reset();
  return [
    event('start', [
      { text: 'A cake has gone missing.', image_id: 'cover.png' },
      { text: 'Type notebook to review your clues.' },
    ]),
    event('move', [{ text: 'You step into the kitchen.', image_id: 'kitchen.png' }], {
      location_name: 'Kitchen',
    }),
  ];
}

describe('buildSessionPages', () => {
  it('returns no pages for an empty history', () => {
    expect(buildSessionPages([])).toEqual([]);
  });

  it('keeps a multi-part start event as a single opening page', () => {
    reset();
    const pages = buildSessionPages([
      event('start', [
        { text: 'A cake has gone missing.', image_id: 'cover.png' },
        { text: 'Type notebook to review your clues.' },
      ]),
    ]);

    expect(pages).toHaveLength(1);
    expect(pages[0].kind).toBe('opening');
    expect(pages[0].imageId).toBe('cover.png');
    expect(pages[0].events).toHaveLength(1);
  });

  it('splits the opening and the arrival into exactly two pages', () => {
    const pages = buildSessionPages(opening(), { mysteryTitle: 'The Missing Cake' });

    expect(pages.map((page) => page.kind)).toEqual(['opening', 'location']);
    expect(pages[0].fallbackLabel).toBe('The Missing Cake');
    expect(pages[1].fallbackLabel).toBe('Kitchen');
    expect(pages[1].imageId).toBe('kitchen.png');
  });

  it('keeps every search at a location on that location page', () => {
    const events = [
      ...opening(),
      event('search', [{ text: 'You find crumbs.' }]),
      event('search', [{ text: 'You find a fork.' }]),
    ];

    const pages = buildSessionPages(events);

    expect(pages).toHaveLength(2);
    expect(pages[1].events).toHaveLength(3);
    expect(pages[1].imageId).toBe('kitchen.png');
  });

  it('keeps a whole conversation on one page and returns to the location after', () => {
    const events = [
      ...opening(),
      event('talk', [{ text: 'Bob looks up.', image_id: 'bob.png' }], {
        character_name: 'Bob',
      }),
      event('ask', [{ text: '"I saw nothing."', image_id: 'bob.png' }]),
      event('ask', [{ text: '"Well, maybe a shadow."', image_id: 'bob.png' }]),
      event('end_talk', [{ text: 'You leave Bob to his work.', image_id: 'kitchen.png' }], {
        location_name: 'Kitchen',
      }),
      event('search', [{ text: 'You check the bin.' }]),
    ];

    const pages = buildSessionPages(events);

    expect(pages.map((page) => page.kind)).toEqual([
      'opening',
      'location',
      'conversation',
      'location',
    ]);

    const conversation = pages[2];
    expect(conversation.fallbackLabel).toBe('Bob');
    expect(conversation.imageId).toBe('bob.png');
    expect(conversation.events).toHaveLength(3);

    // Leaving the conversation opens a location page, and the search that
    // follows joins it rather than starting another.
    const back = pages[3];
    expect(back.fallbackLabel).toBe('Kitchen');
    expect(back.imageId).toBe('kitchen.png');
    expect(back.events).toHaveLength(2);
  });

  it('appends client-side input, feedback, and errors to the open page', () => {
    const events = [
      ...opening(),
      event('input', [{ text: '> search', speaker: INVESTIGATOR_SPEAKER }]),
      event('system_response', [{ text: 'Help menu opened.', speaker: SYSTEM_SPEAKER }]),
      event('error', [{ text: 'Request failed.', speaker: SYSTEM_SPEAKER }]),
    ];

    const pages = buildSessionPages(events);

    expect(pages).toHaveLength(2);
    expect(pages[1].events).toHaveLength(4);
  });

  it('carries the command echo onto the page that command opened', () => {
    reset();
    const pages = buildSessionPages([
      event('move', [{ text: 'You are in the kitchen.' }], { location_name: 'Kitchen' }),
      event('input', [{ text: '> go to the garden', speaker: INVESTIGATOR_SPEAKER }]),
      event('move', [{ text: 'The garden is overgrown.' }], { location_name: 'Garden' }),
    ]);

    expect(pages).toHaveLength(2);
    // The kitchen page ends with the kitchen, not with a dangling command.
    expect(pages[0].events).toHaveLength(1);
    // The garden page opens with the player asking for it.
    expect(pages[1].events.map((e) => e.event_type)).toEqual(['input', 'move']);
    expect(pages[1].fallbackLabel).toBe('Garden');
  });

  it('only carries an echo that is the last thing on the page', () => {
    reset();
    const pages = buildSessionPages([
      event('move', [{ text: 'You are in the kitchen.' }], { location_name: 'Kitchen' }),
      event('input', [{ text: '> search', speaker: INVESTIGATOR_SPEAKER }]),
      event('search', [{ text: 'You find crumbs.' }]),
      event('move', [{ text: 'The garden is overgrown.' }], { location_name: 'Garden' }),
    ]);

    expect(pages[0].events.map((e) => e.event_type)).toEqual(['move', 'input', 'search']);
    expect(pages[1].events.map((e) => e.event_type)).toEqual(['move']);
  });

  it('carries the previous page image forward when an interaction has none', () => {
    const events = [
      ...opening(),
      event('accuse_start', [{ text: 'Name your suspect.' }]),
      event('accuse_round', [{ text: 'Go on.' }]),
    ];

    const pages = buildSessionPages(events);

    expect(pages[2].kind).toBe('accusation');
    expect(pages[2].fallbackLabel).toBe('The accusation');
    // No image of its own, so the scene pane keeps showing where the player is.
    expect(pages[2].imageId).toBe('kitchen.png');
  });

  it('adopts the first image an event contributes to an already-open page', () => {
    reset();
    const pages = buildSessionPages([
      event('move', [{ text: 'You arrive.' }], { location_name: 'Barn' }),
      event('search', [{ text: 'You look around.', image_id: 'barn.png' }]),
    ]);

    expect(pages).toHaveLength(1);
    expect(pages[0].imageId).toBe('barn.png');
  });

  it('opens a page on the first event even when it is not a page-opening type', () => {
    reset();
    const pages = buildSessionPages([event('search', [{ text: 'Orphaned line.' }])]);

    expect(pages).toHaveLength(1);
    expect(pages[0].events).toHaveLength(1);
  });

  it('falls back to a generic label when the payload names nothing', () => {
    reset();
    const pages = buildSessionPages([
      event('move', [{ text: 'You arrive somewhere.' }]),
      event('talk', [{ text: 'Someone turns to you.' }]),
    ]);

    expect(pages[0].fallbackLabel).toBe('Location');
    expect(pages[1].fallbackLabel).toBe('Conversation');
  });

  it('numbers pages from zero in play order', () => {
    const pages = buildSessionPages(opening());
    expect(pages.map((page) => page.index)).toEqual([0, 1]);
  });

  it('treats exactly the scene-changing events as page openers', () => {
    expect([...PAGE_OPENING_EVENT_TYPES].sort()).toEqual([
      'accuse_start',
      'end_talk',
      'move',
      'start',
      'talk',
    ]);
  });
});
