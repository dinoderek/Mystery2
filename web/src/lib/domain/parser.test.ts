import { describe, expect, it } from 'vitest';
import { normalizeInput, parseCommand, type ParseContext } from './parser';

const context: ParseContext = {
  locations: [{ name: 'Kitchen' }, { name: 'Garden' }, { name: 'Barn' }],
  characters: [
    { first_name: 'Rosie', last_name: 'Jones', location_name: 'Kitchen' },
    { first_name: 'Mayor', last_name: 'Fox', location_name: 'Kitchen' },
    { first_name: 'Bob', last_name: 'Smith', location_name: 'Garden' },
  ],
  currentLocation: 'Kitchen',
};

describe('normalizeInput', () => {
  it('normalizes casing, whitespace, and trailing punctuation', () => {
    expect(normalizeInput('  Go To   The Kitchen!  ')).toBe('go to the kitchen');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeInput('   ')).toBe('');
  });
});

describe('parseCommand - aliases and modes', () => {
  it('matches move aliases in explore mode', () => {
    expect(parseCommand('travel to kitchen', 'explore', context)).toEqual({
      type: 'valid',
      command: { type: 'move', destination: 'Kitchen' },
    });

    expect(parseCommand('head towards barn', 'explore', context)).toEqual({
      type: 'valid',
      command: { type: 'move', destination: 'Barn' },
    });
  });

  it('matches talk aliases in explore mode', () => {
    expect(parseCommand('speak with mayor fox', 'explore', context)).toEqual({
      type: 'valid',
      command: { type: 'talk', character_name: 'Mayor' },
    });
  });

  it('matches search aliases in explore mode', () => {
    expect(parseCommand('inspect the room', 'explore', context)).toEqual({
      type: 'valid',
      command: { type: 'search' },
    });
    expect(parseCommand('look around', 'explore', context)).toEqual({
      type: 'valid',
      command: { type: 'search' },
    });
  });

  it('matches end-talk aliases in talk mode', () => {
    expect(parseCommand('goodbye', 'talk', context)).toEqual({
      type: 'valid',
      command: { type: 'end_talk' },
    });
    expect(parseCommand('see you', 'talk', context)).toEqual({
      type: 'valid',
      command: { type: 'end_talk' },
    });
  });

  it('supports quit aliases in all modes', () => {
    expect(parseCommand('quit', 'explore', context)).toEqual({ type: 'quit' });
    expect(parseCommand('exit', 'talk', context)).toEqual({ type: 'quit' });
    expect(parseCommand('quit', 'accuse', context)).toEqual({ type: 'quit' });
    expect(parseCommand('exit', 'ended', context)).toEqual({ type: 'quit' });
  });

  it('falls back to ask in talk and accuse modes for non-exact commands', () => {
    expect(parseCommand('go to kitchen', 'talk', context)).toEqual({
      type: 'valid',
      command: { type: 'ask', question: 'go to kitchen' },
    });

    expect(parseCommand('travel to garden', 'accuse', context)).toEqual({
      type: 'valid',
      command: { type: 'ask', question: 'travel to garden' },
    });
  });

  it('treats command-like input as reasoning while in accuse mode', () => {
    expect(parseCommand('talk to mayor', 'accuse', context)).toEqual({
      type: 'valid',
      command: { type: 'ask', question: 'talk to mayor' },
    });

    expect(parseCommand('search under the table', 'accuse', context)).toEqual({
      type: 'valid',
      command: { type: 'ask', question: 'search under the table' },
    });
  });

  it('returns unrecognized with mode hint in ended mode', () => {
    const result = parseCommand('jump over fence', 'ended', context);
    expect(result.type).toBe('unrecognized');
    if (result.type === 'unrecognized') {
      expect(result.hint).toContain('help');
      expect(result.hint).toContain('quit');
    }
  });
});

describe('parseCommand - target validation and lists', () => {
  it('returns missing-target for bare movement commands', () => {
    const result = parseCommand('go', 'explore', context);
    expect(result).toEqual({
      type: 'missing-target',
      commandType: 'move',
      suggestions: ['Kitchen', 'Garden', 'Barn', 'Rosie Jones', 'Mayor Fox'],
    });
  });

  it('returns missing-target for bare talk commands', () => {
    const result = parseCommand('talk to', 'explore', context);
    expect(result).toEqual({
      type: 'missing-target',
      commandType: 'talk',
      suggestions: ['Rosie Jones', 'Mayor Fox'],
    });
  });

  it('returns invalid-target with suggestions for unknown movement target', () => {
    const result = parseCommand('go to zyx', 'explore', context);
    expect(result).toEqual({
      type: 'invalid-target',
      commandType: 'move',
      attempted: 'zyx',
      suggestions: ['Kitchen', 'Garden', 'Barn', 'Rosie Jones', 'Mayor Fox'],
    });
  });

  it('returns invalid-target with suggestions for unknown talk target', () => {
    const result = parseCommand('talk to zyx', 'explore', context);
    expect(result).toEqual({
      type: 'invalid-target',
      commandType: 'talk',
      attempted: 'zyx',
      suggestions: ['Rosie Jones', 'Mayor Fox'],
    });
  });

  it('parses list aliases for locations and characters', () => {
    const locations = parseCommand('where can i go', 'explore', context);
    expect(locations.type).toBe('list');
    if (locations.type === 'list') {
      expect(locations.listType).toBe('locations');
      expect(locations.items).toEqual([
        { kind: 'location', name: 'Kitchen', characters: ['Rosie Jones', 'Mayor Fox'] },
        { kind: 'location', name: 'Garden', characters: ['Bob Smith'] },
        { kind: 'location', name: 'Barn', characters: [] },
      ]);
    }

    const characters = parseCommand('characters', 'explore', context);
    expect(characters.type).toBe('list');
    if (characters.type === 'list') {
      expect(characters.listType).toBe('characters');
      expect(characters.items).toEqual([
        { kind: 'character', displayName: 'Rosie Jones' },
        { kind: 'character', displayName: 'Mayor Fox' },
      ]);
    }
  });

  it('resolves character by first and last name', () => {
    expect(parseCommand('talk to rosie', 'explore', context)).toEqual({
      type: 'valid',
      command: { type: 'talk', character_name: 'Rosie' },
    });

    expect(parseCommand('talk to fox', 'explore', context)).toEqual({
      type: 'valid',
      command: { type: 'talk', character_name: 'Mayor' },
    });
  });

  it('parses help and unrecognized branch with mode-aware hint', () => {
    expect(parseCommand('help', 'explore', context)).toEqual({ type: 'help' });

    const result = parseCommand('wander to market', 'explore', context);
    expect(result.type).toBe('unrecognized');
    if (result.type === 'unrecognized') {
      expect(result.hint).toContain('move to/go to');
      expect(result.hint).toContain('talk to');
      expect(result.hint).toContain('help');
    }
  });
});
