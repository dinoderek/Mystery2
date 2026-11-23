import { describe, expect, it } from 'vitest';
import { accusationsLeftText } from './accusations';

describe('accusationsLeftText', () => {
  it.each([
    [3, '3 accusations left'],
    [2, '2 accusations left'],
    [1, '1 accusation left'],
    [0, 'No accusations left'],
  ])('says %i as "%s"', (left, text) => {
    expect(accusationsLeftText(left)).toBe(text);
  });

  it('never says a negative count', () => {
    expect(accusationsLeftText(-1)).toBe('No accusations left');
  });
});
