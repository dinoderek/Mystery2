import { describe, expect, it } from 'vitest';

import { landingRows, pickLandingChoice, pickNumbered } from './landing-menu';

describe('landingRows', () => {
  it('numbers the rows and carries the counts of the two lists', () => {
    const rows = landingRows({ in_progress: 2, completed: 5 });

    expect(rows.map((row) => [row.number, row.choice, row.count])).toEqual([
      [1, 'new-game', null],
      [2, 'in-progress', 2],
      [3, 'completed', 5],
    ]);
  });

  it('enables a list row only when it has sessions', () => {
    const rows = landingRows({ in_progress: 0, completed: 1 });

    expect(rows.map((row) => row.enabled)).toEqual([true, false, true]);
  });
});

describe('pickLandingChoice', () => {
  it('picks the row a key names', () => {
    const counts = { in_progress: 1, completed: 1 };

    expect(pickLandingChoice('1', counts)).toBe('new-game');
    expect(pickLandingChoice('2', counts)).toBe('in-progress');
    expect(pickLandingChoice('3', counts)).toBe('completed');
  });

  it('picks nothing for a disabled row or a key that names no row', () => {
    const counts = { in_progress: 0, completed: 0 };

    expect(pickLandingChoice('2', counts)).toBeNull();
    expect(pickLandingChoice('3', counts)).toBeNull();
    expect(pickLandingChoice('4', counts)).toBeNull();
    expect(pickLandingChoice('b', counts)).toBeNull();
  });
});

describe('pickNumbered', () => {
  const items = ['a', 'b', 'c'];

  it('picks the item at a one-based number', () => {
    expect(pickNumbered('1', items)).toBe('a');
    expect(pickNumbered('3', items)).toBe('c');
  });

  it('picks nothing outside the list or for a key that is not a number', () => {
    expect(pickNumbered('0', items)).toBeNull();
    expect(pickNumbered('4', items)).toBeNull();
    expect(pickNumbered('b', items)).toBeNull();
    expect(pickNumbered('1', [])).toBeNull();
  });
});
