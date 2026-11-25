import { describe, expect, it } from 'vitest';
import { isCoarsePointer, shouldFocusInput } from './input-focus';

describe('shouldFocusInput', () => {
  it('keeps autofocus on a fine pointer, whatever the trigger', () => {
    expect(shouldFocusInput(false, 'ready')).toBe(true);
    expect(shouldFocusInput(false, 'sent')).toBe(true);
  });

  it('leaves the input alone on a coarse pointer until a line is sent', () => {
    expect(shouldFocusInput(true, 'ready')).toBe(false);
    expect(shouldFocusInput(true, 'sent')).toBe(true);
  });
});

describe('isCoarsePointer', () => {
  it('asks the pointer media query', () => {
    const asked: string[] = [];
    const coarse = isCoarsePointer((query) => {
      asked.push(query);
      return { matches: true };
    });

    expect(coarse).toBe(true);
    expect(asked).toEqual(['(pointer: coarse)']);
    expect(isCoarsePointer(() => ({ matches: false }))).toBe(false);
  });
});
