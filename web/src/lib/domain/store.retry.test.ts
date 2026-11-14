import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callWithRetry,
  classifyFailure,
  getBackoffDelayMs,
  isImageLinkExpired,
  isTransientFailure,
} from './store.retry';

describe('store.retry', () => {
  it('classifies 5xx and 429/408 as transient', () => {
    expect(classifyFailure({ status: 500, message: 'server error' })).toBe('transient');
    expect(classifyFailure({ status: 503, message: 'unavailable' })).toBe('transient');
    expect(classifyFailure({ status: 429, message: 'rate limit' })).toBe('transient');
    expect(classifyFailure({ status: 408, message: 'timeout' })).toBe('transient');
  });

  it('classifies 4xx as permanent', () => {
    expect(classifyFailure({ status: 400, message: 'bad request' })).toBe('permanent');
    expect(classifyFailure({ status: 404, message: 'not found' })).toBe('permanent');
  });

  it('classifies network errors as transient', () => {
    expect(isTransientFailure({ message: 'fetch failed' })).toBe(true);
    expect(isTransientFailure(null, new TypeError('Failed to fetch'))).toBe(true);
  });

  it('defaults unknown failures to permanent', () => {
    expect(classifyFailure({ message: 'validation failed' })).toBe('permanent');
  });

  it('provides exponential backoff sequence', () => {
    expect(getBackoffDelayMs(1)).toBe(300);
    expect(getBackoffDelayMs(2)).toBe(600);
    expect(getBackoffDelayMs(3)).toBe(1200);
    expect(getBackoffDelayMs(10)).toBe(2000);
  });

  it('marks image links expired near or past expiry time', () => {
    const now = Date.UTC(2030, 0, 1, 0, 0, 0);
    expect(isImageLinkExpired(new Date(now + 60_000).toISOString(), now)).toBe(false);
    expect(isImageLinkExpired(new Date(now + 2_000).toISOString(), now, 5_000)).toBe(true);
    expect(isImageLinkExpired(new Date(now - 1_000).toISOString(), now)).toBe(true);
  });
});

describe('callWithRetry', () => {
  const waits: number[] = [];
  const wait = async (ms: number) => {
    waits.push(ms);
  };
  const failing = (status: number) => ({ data: null, error: { message: `HTTP ${status}`, status } });

  beforeEach(() => {
    waits.length = 0;
  });

  it('returns the first answer without waiting', async () => {
    const result = await callWithRetry(async () => ({ data: 'ok', error: null }), () => {}, 3, wait);

    expect(result).toEqual({ ok: true, data: 'ok' });
    expect(waits).toEqual([]);
  });

  it('backs off between transient failures and reports each one', async () => {
    const retried: number[] = [];
    const call = vi.fn().mockResolvedValueOnce(failing(503)).mockResolvedValueOnce(failing(503)).mockResolvedValueOnce({ data: 'ok', error: null });

    const result = await callWithRetry(call, (attempt) => retried.push(attempt), 3, wait);

    expect(result).toEqual({ ok: true, data: 'ok' });
    expect(retried).toEqual([1, 2]);
    expect(waits).toEqual([getBackoffDelayMs(1), getBackoffDelayMs(2)]);
  });

  it('stops at once on a failure that retrying cannot fix', async () => {
    const call = vi.fn().mockResolvedValue(failing(409));

    const result = await callWithRetry(call, () => {}, 3, wait);

    expect(result).toEqual({ ok: false, failure: { message: 'HTTP 409', status: 409, exhausted: false } });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('gives up after the last attempt', async () => {
    const call = vi.fn().mockResolvedValue(failing(500));

    const result = await callWithRetry(call, () => {}, 3, wait);

    expect(result).toMatchObject({ ok: false, failure: { status: 500, exhausted: true } });
    expect(call).toHaveBeenCalledTimes(3);
    expect(waits).toHaveLength(2);
  });

  it('treats a thrown network failure as transient', async () => {
    const call = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ data: 1, error: null });

    const result = await callWithRetry(call, () => {}, 3, wait);

    expect(result).toEqual({ ok: true, data: 1 });
  });
});
