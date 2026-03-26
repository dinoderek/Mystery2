import { supabase, supabaseUrl } from './supabase';
import {
  isImageLinkExpired,
  classifyFailure,
  getBackoffDelayMs,
  sleep,
  type InvokeFailure,
} from '$lib/domain/store.retry';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const EXPIRY_BUFFER_MS = REFRESH_INTERVAL_MS * 1.5; // refresh well before actual expiry
const MAX_RESOLVE_ATTEMPTS = 3;

export interface ImageLinkEntry {
  url: string | null;
  expiresAt: string | null;
  loading: boolean;
  placeholder: boolean;
}

type Subscriber = (entry: ImageLinkEntry) => void;

interface CacheRecord {
  entry: ImageLinkEntry;
  blueprintId: string;
  imageId: string;
  subscribers: Set<Subscriber>;
  resolvePromise: Promise<void> | null;
}

interface ImageLinkResponse {
  image_id: string;
  signed_url: string;
  expires_at: string;
}

function cacheKey(blueprintId: string, imageId: string): string {
  return `${blueprintId}:${imageId}`;
}

function parseResponse(data: unknown): ImageLinkResponse | null {
  if (!data || typeof data !== 'object') return null;
  const typed = data as Record<string, unknown>;
  if (
    typeof typed.image_id !== 'string' ||
    typeof typed.signed_url !== 'string' ||
    typeof typed.expires_at !== 'string'
  ) {
    return null;
  }
  return {
    image_id: typed.image_id,
    signed_url: typed.signed_url,
    expires_at: typed.expires_at,
  };
}

class ImageLinkCache {
  private records = new Map<string, CacheRecord>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  subscribe(
    blueprintId: string,
    imageId: string,
    callback: Subscriber,
  ): () => void {
    const key = cacheKey(blueprintId, imageId);
    let record = this.records.get(key);

    if (!record) {
      record = {
        entry: { url: null, expiresAt: null, loading: false, placeholder: false },
        blueprintId,
        imageId,
        subscribers: new Set(),
        resolvePromise: null,
      };
      this.records.set(key, record);
    }

    record.subscribers.add(callback);
    this.ensureSweepRunning();

    // If we already have a valid URL, notify immediately
    if (record.entry.url && !isImageLinkExpired(record.entry.expiresAt, undefined, EXPIRY_BUFFER_MS)) {
      callback(record.entry);
    } else if (!record.entry.loading) {
      // Need to resolve
      this.resolveEntry(key, record);
    } else {
      // Already loading, send current state
      callback(record.entry);
    }

    return () => {
      record!.subscribers.delete(callback);
      if (record!.subscribers.size === 0) {
        this.records.delete(key);
        if (this.records.size === 0) {
          this.stopSweep();
        }
      }
    };
  }

  private notify(record: CacheRecord) {
    for (const sub of record.subscribers) {
      sub(record.entry);
    }
  }

  private async resolveEntry(key: string, record: CacheRecord): Promise<void> {
    if (record.resolvePromise) return;

    const isRefresh = record.entry.url !== null;

    if (!isRefresh) {
      record.entry = { ...record.entry, loading: true };
      this.notify(record);
    }

    record.resolvePromise = (async () => {
      try {
        for (let attempt = 1; attempt <= MAX_RESOLVE_ATTEMPTS; attempt++) {
          // Check the record is still alive before each attempt
          if (!this.records.has(key)) return;

          let data: unknown = null;
          let error: InvokeFailure | null = null;
          let thrownError: unknown = undefined;

          try {
            const result = await supabase.functions.invoke('blueprint-image-link', {
              body: {
                blueprint_id: record.blueprintId,
                image_id: record.imageId,
              },
            });
            data = result.data;
            error = result.error as InvokeFailure | null;
          } catch (e) {
            thrownError = e;
          }

          // Record may have been removed while awaiting
          if (!this.records.has(key)) return;

          // Success path — check data validity
          if (!error && !thrownError) {
            const parsed = parseResponse(data);
            if (parsed && parsed.image_id === record.imageId) {
              const fullUrl = parsed.signed_url.startsWith('/')
                ? `${supabaseUrl}${parsed.signed_url}`
                : parsed.signed_url;

              record.entry = {
                url: fullUrl,
                expiresAt: parsed.expires_at,
                loading: false,
                placeholder: false,
              };
              this.notify(record);
              return;
            }
            // Mismatched image_id or bad response shape — permanent, no retry
            break;
          }

          // Failure path — classify and maybe retry
          const classification = classifyFailure(error, thrownError);
          if (classification === 'permanent' || attempt === MAX_RESOLVE_ATTEMPTS) {
            break;
          }

          // Transient failure — backoff and retry
          await sleep(getBackoffDelayMs(attempt));
        }

        // All attempts exhausted or permanent failure
        if (!this.records.has(key)) return;
        if (!isRefresh) {
          record.entry = { url: null, expiresAt: null, loading: false, placeholder: true };
          this.notify(record);
        }
        // On refresh failure, keep the stale URL — next sweep will retry
      } finally {
        record.resolvePromise = null;
      }
    })();
  }

  private ensureSweepRunning() {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), REFRESH_INTERVAL_MS);
  }

  private stopSweep() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private sweep() {
    for (const [key, record] of this.records) {
      if (record.subscribers.size === 0) continue;
      if (record.entry.loading) continue;
      if (isImageLinkExpired(record.entry.expiresAt, undefined, EXPIRY_BUFFER_MS)) {
        this.resolveEntry(key, record);
      }
    }
  }

  /** Visible for testing */
  _getRecord(blueprintId: string, imageId: string): CacheRecord | undefined {
    return this.records.get(cacheKey(blueprintId, imageId));
  }

  /** Visible for testing */
  _triggerSweep() {
    this.sweep();
  }

  clear() {
    this.stopSweep();
    this.records.clear();
  }
}

export const imageLinkCache = new ImageLinkCache();
