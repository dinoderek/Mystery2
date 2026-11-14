import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameTurnResponseSchema } from '@my2/shared';
import { readAnswer, readContract } from './contract';
import { createTurnQuitResponse } from '../../../../tests/testkit/src/fixtures';

describe('readContract', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns what the schema accepts', () => {
    expect(readContract(GameTurnResponseSchema, createTurnQuitResponse(), 'game-turn')).toEqual({
      ok: true,
      value: { kind: 'quit' },
    });
  });

  it('names the endpoint and the first bad field, and logs every issue', () => {
    const read = readContract(
      GameTurnResponseSchema,
      { kind: 'refused', reason: 'unrecognized', hint: '' },
      'game-turn',
    );

    expect(read.ok).toBe(false);
    expect(!read.ok && read.message).toContain('game-turn');
    expect(!read.ok && read.message).toContain('hint');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('game-turn'), expect.any(Array));
  });

  it('refuses a body that is not an object at all', () => {
    expect(readContract(GameTurnResponseSchema, null, 'game-turn').ok).toBe(false);
  });
});

describe('readAnswer', () => {
  it('keeps the failure of a request that failed, without logging a contract problem', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const read = readAnswer({ data: null, error: { message: 'Not signed in' } }, GameTurnResponseSchema, 'game-turn');

    expect(read).toEqual({ ok: false, message: 'Not signed in' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
