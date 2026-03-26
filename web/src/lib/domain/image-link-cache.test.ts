import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
const sleepMock = vi.hoisted(() => vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined));

vi.mock('../api/supabase', () => ({
  supabase: {
    functions: {
      invoke: invokeMock,
    },
  },
  supabaseUrl: 'http://localhost:54321',
}));

vi.mock('./store.retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./store.retry')>();
  return { ...actual, sleep: sleepMock };
});

// Must import after mocking
import { imageLinkCache, type ImageLinkEntry } from '../api/image-link-cache';

function futureExpiry(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function pastExpiry(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

function mockSuccessResponse(imageId: string, expiresAt?: string) {
  return {
    data: {
      image_id: imageId,
      signed_url: '/storage/v1/object/sign/blueprint-images/test/img.png?token=abc',
      expires_at: expiresAt ?? futureExpiry(60),
    },
    error: null,
  };
}

describe('ImageLinkCache', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    sleepMock.mockClear();
    imageLinkCache.clear();
  });

  afterEach(() => {
    imageLinkCache.clear();
  });

  it('resolves and notifies subscriber on first subscribe', async () => {
    invokeMock.mockResolvedValueOnce(mockSuccessResponse('cover.png'));

    const updates: ImageLinkEntry[] = [];
    const unsub = imageLinkCache.subscribe('bp-1', 'cover.png', (entry) => {
      updates.push({ ...entry });
    });

    // Wait for async resolution
    await vi.waitFor(() => expect(updates.length).toBeGreaterThanOrEqual(2));

    // First notification: loading
    expect(updates[0].loading).toBe(true);
    expect(updates[0].url).toBeNull();

    // Second notification: resolved
    const resolved = updates[updates.length - 1];
    expect(resolved.loading).toBe(false);
    expect(resolved.url).toContain('http://localhost:54321/storage/v1/');
    expect(resolved.placeholder).toBe(false);

    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith('blueprint-image-link', {
      body: { blueprint_id: 'bp-1', image_id: 'cover.png' },
    });

    unsub();
  });

  it('shares cache across multiple subscribers for the same key', async () => {
    invokeMock.mockResolvedValueOnce(mockSuccessResponse('cover.png'));

    const updates1: ImageLinkEntry[] = [];
    const updates2: ImageLinkEntry[] = [];

    const unsub1 = imageLinkCache.subscribe('bp-1', 'cover.png', (entry) => {
      updates1.push({ ...entry });
    });

    // Wait for first subscriber to resolve
    await vi.waitFor(() => expect(updates1.some((u) => !u.loading)).toBe(true));

    // Second subscriber should get the cached result immediately
    const unsub2 = imageLinkCache.subscribe('bp-1', 'cover.png', (entry) => {
      updates2.push({ ...entry });
    });

    expect(updates2.length).toBe(1);
    expect(updates2[0].loading).toBe(false);
    expect(updates2[0].url).toContain('http://localhost:54321');

    // Only one edge function call
    expect(invokeMock).toHaveBeenCalledOnce();

    unsub1();
    unsub2();
  });

  it('cleans up record when all subscribers unsubscribe', async () => {
    invokeMock.mockResolvedValueOnce(mockSuccessResponse('cover.png'));

    const unsub = imageLinkCache.subscribe('bp-1', 'cover.png', () => {});
    await vi.waitFor(() => {
      expect(imageLinkCache._getRecord('bp-1', 'cover.png')).toBeDefined();
    });

    unsub();
    expect(imageLinkCache._getRecord('bp-1', 'cover.png')).toBeUndefined();
  });

  it('sets placeholder on edge function error', async () => {
    invokeMock.mockResolvedValueOnce({ data: null, error: { message: 'fail' } });

    const updates: ImageLinkEntry[] = [];
    const unsub = imageLinkCache.subscribe('bp-1', 'cover.png', (entry) => {
      updates.push({ ...entry });
    });

    await vi.waitFor(() => expect(updates.some((u) => !u.loading)).toBe(true));

    const last = updates[updates.length - 1];
    expect(last.url).toBeNull();
    expect(last.placeholder).toBe(true);
    expect(last.loading).toBe(false);

    unsub();
  });

  it('sets placeholder when response has mismatched image_id', async () => {
    invokeMock.mockResolvedValueOnce(mockSuccessResponse('wrong-id.png'));

    const updates: ImageLinkEntry[] = [];
    const unsub = imageLinkCache.subscribe('bp-1', 'cover.png', (entry) => {
      updates.push({ ...entry });
    });

    await vi.waitFor(() => expect(updates.some((u) => !u.loading)).toBe(true));

    expect(updates[updates.length - 1].placeholder).toBe(true);
    unsub();
  });

  it('sweep re-resolves expired entries with active subscribers', async () => {
    // First resolve with an already-expired URL
    invokeMock.mockResolvedValueOnce(mockSuccessResponse('cover.png', pastExpiry()));

    const updates: ImageLinkEntry[] = [];
    const unsub = imageLinkCache.subscribe('bp-1', 'cover.png', (entry) => {
      updates.push({ ...entry });
    });

    await vi.waitFor(() => expect(updates.some((u) => !u.loading)).toBe(true));
    const resolveCount = updates.length;

    // Set up new response for the sweep
    invokeMock.mockResolvedValueOnce(mockSuccessResponse('cover.png', futureExpiry(60)));

    // Trigger sweep manually
    imageLinkCache._triggerSweep();

    await vi.waitFor(() => expect(updates.length).toBeGreaterThan(resolveCount));

    const last = updates[updates.length - 1];
    expect(last.loading).toBe(false);
    expect(last.url).toContain('http://localhost:54321');

    // Two edge function calls total (initial + sweep)
    expect(invokeMock).toHaveBeenCalledTimes(2);

    unsub();
  });

  it('does not re-resolve entries with valid expiry on sweep', async () => {
    invokeMock.mockResolvedValueOnce(mockSuccessResponse('cover.png', futureExpiry(60)));

    const unsub = imageLinkCache.subscribe('bp-1', 'cover.png', () => {});
    await vi.waitFor(() => {
      const rec = imageLinkCache._getRecord('bp-1', 'cover.png');
      expect(rec?.entry.loading).toBe(false);
    });

    imageLinkCache._triggerSweep();

    // Still only one call
    expect(invokeMock).toHaveBeenCalledOnce();

    unsub();
  });

  it('keeps stale URL when sweep refresh fails', async () => {
    // First resolve successfully with an already-expired URL
    invokeMock.mockResolvedValueOnce(mockSuccessResponse('cover.png', pastExpiry()));

    const updates: ImageLinkEntry[] = [];
    const unsub = imageLinkCache.subscribe('bp-1', 'cover.png', (entry) => {
      updates.push({ ...entry });
    });

    await vi.waitFor(() => expect(updates.some((u) => u.url !== null)).toBe(true));
    const resolvedUrl = updates.find((u) => u.url !== null)!.url;
    const countAfterResolve = updates.length;

    // Sweep refresh fails
    invokeMock.mockResolvedValueOnce({ data: null, error: { message: 'network error' } });
    imageLinkCache._triggerSweep();

    // Wait for the failed refresh to complete
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    // Small delay to let any notifications propagate
    await new Promise((r) => setTimeout(r, 50));

    // No new notifications — stale URL is preserved silently
    expect(updates.length).toBe(countAfterResolve);
    const record = imageLinkCache._getRecord('bp-1', 'cover.png');
    expect(record?.entry.url).toBe(resolvedUrl);
    expect(record?.entry.placeholder).toBe(false);

    unsub();
  });

  it('prepends supabaseUrl to relative signed URLs', async () => {
    invokeMock.mockResolvedValueOnce(mockSuccessResponse('cover.png'));

    const updates: ImageLinkEntry[] = [];
    const unsub = imageLinkCache.subscribe('bp-1', 'cover.png', (entry) => {
      updates.push({ ...entry });
    });

    await vi.waitFor(() => expect(updates.some((u) => u.url !== null)).toBe(true));

    const withUrl = updates.find((u) => u.url !== null)!;
    expect(withUrl.url).toBe(
      'http://localhost:54321/storage/v1/object/sign/blueprint-images/test/img.png?token=abc',
    );

    unsub();
  });

  it('retries transient errors with backoff then succeeds', async () => {
    // First two calls: transient 500 errors. Third call: success.
    invokeMock
      .mockResolvedValueOnce({ data: null, error: { message: 'server error', status: 500 } })
      .mockResolvedValueOnce({ data: null, error: { message: 'server error', status: 500 } })
      .mockResolvedValueOnce(mockSuccessResponse('cover.png'));

    const updates: ImageLinkEntry[] = [];
    const unsub = imageLinkCache.subscribe('bp-1', 'cover.png', (entry) => {
      updates.push({ ...entry });
    });

    await vi.waitFor(() => expect(updates.some((u) => u.url !== null)).toBe(true));

    // All 3 attempts made
    expect(invokeMock).toHaveBeenCalledTimes(3);
    // sleep called between attempts 1→2 and 2→3
    expect(sleepMock).toHaveBeenCalledTimes(2);

    const resolved = updates[updates.length - 1];
    expect(resolved.loading).toBe(false);
    expect(resolved.url).toContain('http://localhost:54321');
    expect(resolved.placeholder).toBe(false);

    unsub();
  });

  it('does not retry permanent errors', async () => {
    // 404 is a permanent failure
    invokeMock.mockResolvedValueOnce({ data: null, error: { message: 'not found', status: 404 } });

    const updates: ImageLinkEntry[] = [];
    const unsub = imageLinkCache.subscribe('bp-1', 'cover.png', (entry) => {
      updates.push({ ...entry });
    });

    await vi.waitFor(() => expect(updates.some((u) => !u.loading)).toBe(true));

    // Only 1 attempt — no retries for permanent errors
    expect(invokeMock).toHaveBeenCalledOnce();
    expect(sleepMock).not.toHaveBeenCalled();

    const last = updates[updates.length - 1];
    expect(last.placeholder).toBe(true);
    expect(last.url).toBeNull();

    unsub();
  });

  it('shows placeholder after exhausting all retry attempts on first resolve', async () => {
    // All 3 attempts fail with transient errors
    invokeMock
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout', status: 503 } })
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout', status: 503 } })
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout', status: 503 } });

    const updates: ImageLinkEntry[] = [];
    const unsub = imageLinkCache.subscribe('bp-1', 'cover.png', (entry) => {
      updates.push({ ...entry });
    });

    await vi.waitFor(() => expect(updates.some((u) => u.placeholder)).toBe(true));

    expect(invokeMock).toHaveBeenCalledTimes(3);
    // sleep called between attempts 1→2 and 2→3
    expect(sleepMock).toHaveBeenCalledTimes(2);

    const last = updates[updates.length - 1];
    expect(last.placeholder).toBe(true);
    expect(last.loading).toBe(false);
    expect(last.url).toBeNull();

    unsub();
  });

  it('retries transient refresh failures and keeps stale URL on exhaustion', async () => {
    // First resolve succeeds with expired URL
    invokeMock.mockResolvedValueOnce(mockSuccessResponse('cover.png', pastExpiry()));

    const updates: ImageLinkEntry[] = [];
    const unsub = imageLinkCache.subscribe('bp-1', 'cover.png', (entry) => {
      updates.push({ ...entry });
    });

    await vi.waitFor(() => expect(updates.some((u) => u.url !== null)).toBe(true));
    const resolvedUrl = updates.find((u) => u.url !== null)!.url;
    const countAfterResolve = updates.length;

    // Sweep triggers refresh — all 3 retry attempts fail with transient errors
    invokeMock
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout', status: 503 } })
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout', status: 503 } })
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout', status: 503 } });

    sleepMock.mockClear();
    imageLinkCache._triggerSweep();

    // Wait for all retry attempts to complete (1 initial + 3 retries = 4 total)
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(4));
    await new Promise((r) => setTimeout(r, 50));

    // Stale URL preserved, no new notifications
    expect(updates.length).toBe(countAfterResolve);
    const record = imageLinkCache._getRecord('bp-1', 'cover.png');
    expect(record?.entry.url).toBe(resolvedUrl);
    expect(record?.entry.placeholder).toBe(false);

    // Retries happened with backoff
    expect(sleepMock).toHaveBeenCalledTimes(2);

    unsub();
  });
});
