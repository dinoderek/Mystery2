import { describe, expect, it } from 'vitest';
import {
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
