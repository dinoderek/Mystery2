import { describe, expect, it } from 'vitest';

import {
  INVESTIGATOR_SPEAKER,
  NARRATOR_SPEAKER,
  SYSTEM_SPEAKER,
  createCharacterSpeaker,
  isSpeaker,
  readSpeaker,
} from './speaker';

describe('createCharacterSpeaker', () => {
  it('keys a character by a slug of the name and keeps the name as the label', () => {
    expect(createCharacterSpeaker('Lady Ashworth')).toEqual({
      kind: 'character',
      key: 'character:lady-ashworth',
      label: 'Lady Ashworth',
    });
  });

  it('gives names that differ only in case or punctuation the same key', () => {
    expect(createCharacterSpeaker("  O'Neil, Jr. ").key).toBe('character:o-neil-jr');
    expect(createCharacterSpeaker('o neil jr').key).toBe('character:o-neil-jr');
  });

  it('uses a generic label for a blank name and a fallback key for a name with no letters', () => {
    expect(createCharacterSpeaker('   ')).toEqual({
      kind: 'character',
      key: 'character:character',
      label: 'Character',
    });
    expect(createCharacterSpeaker('???').key).toBe('character:unknown');
  });
});

describe('isSpeaker', () => {
  it('accepts every kind of speaker', () => {
    for (const speaker of [
      INVESTIGATOR_SPEAKER,
      NARRATOR_SPEAKER,
      SYSTEM_SPEAKER,
      createCharacterSpeaker('Ann'),
    ]) {
      expect(isSpeaker(speaker)).toBe(true);
    }
  });

  it('rejects anything that is not an object with a known kind, a key and a label', () => {
    expect(isSpeaker(null)).toBe(false);
    expect(isSpeaker('narrator')).toBe(false);
    expect(isSpeaker([])).toBe(false);
    expect(isSpeaker({ kind: 'ghost', key: 'k', label: 'l' })).toBe(false);
    expect(isSpeaker({ kind: 'narrator', key: '', label: 'l' })).toBe(false);
    expect(isSpeaker({ kind: 'narrator', key: 'k', label: '' })).toBe(false);
    expect(isSpeaker({ kind: 'narrator', key: 1, label: 'l' })).toBe(false);
    expect(isSpeaker({ kind: 'narrator', key: 'k', label: 2 })).toBe(false);
  });
});

describe('readSpeaker', () => {
  it('returns a valid speaker as it is', () => {
    const speaker = createCharacterSpeaker('Ann');

    expect(readSpeaker(speaker)).toBe(speaker);
  });

  it('falls back to the narrator, or to the speaker it is given', () => {
    expect(readSpeaker({ kind: 'bad' })).toBe(NARRATOR_SPEAKER);
    expect(readSpeaker(undefined, SYSTEM_SPEAKER)).toBe(SYSTEM_SPEAKER);
  });
});
