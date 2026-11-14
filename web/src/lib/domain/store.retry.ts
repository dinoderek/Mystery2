export interface InvokeFailure {
  message?: string | null;
  status?: number;
}

export type RetryClassification = 'transient' | 'permanent';

const NETWORK_ERROR_PATTERNS = [
  'networkerror',
  'fetch failed',
  'failed to fetch',
  'connection reset',
  'timed out',
  'timeout',
  'temporarily unavailable',
];

export function classifyFailure(error: InvokeFailure | null, thrownError?: unknown): RetryClassification {
  const status = error?.status;

  if (typeof status === 'number') {
    if (status >= 500 || status === 429 || status === 408) {
      return 'transient';
    }
    if (status >= 400) {
      return 'permanent';
    }
  }

  const message = [error?.message, thrownError instanceof Error ? thrownError.message : '']
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (thrownError instanceof TypeError) {
    return 'transient';
  }

  if (NETWORK_ERROR_PATTERNS.some((pattern) => message.includes(pattern))) {
    return 'transient';
  }

  return 'permanent';
}

export function isTransientFailure(error: InvokeFailure | null, thrownError?: unknown): boolean {
  return classifyFailure(error, thrownError) === 'transient';
}

export function getBackoffDelayMs(attempt: number): number {
  const base = 300;
  const maxDelay = 2000;
  const safeAttempt = Math.max(1, attempt);
  return Math.min(base * 2 ** (safeAttempt - 1), maxDelay);
}

export interface AttemptFailure extends InvokeFailure {
  /** The request kept failing in a way that was worth retrying, and ran out of tries. */
  exhausted: boolean;
}

export type AttemptResult<T> = { ok: true; data: T } | { ok: false; failure: AttemptFailure };

interface CallResult<T> {
  data: T | null;
  error: { message: string; status?: number } | null;
}

/**
 * Runs `call` up to `maxAttempts` times, backing off between tries while the
 * failure is transient. `onRetry` is told which attempt just failed, before the
 * wait, so the screen can say so.
 */
export async function callWithRetry<T>(
  call: () => Promise<CallResult<T>>,
  onRetry: (attempt: number) => void,
  maxAttempts = 3,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<AttemptResult<T>> {
  for (let attempt = 1; ; attempt += 1) {
    const result = await attemptOnce(call);
    if ('data' in result) {
      return { ok: true, data: result.data };
    }

    const exhausted = result.transient && attempt >= maxAttempts;
    if (!result.transient || exhausted) {
      return { ok: false, failure: { ...result.failure, exhausted } };
    }

    onRetry(attempt);
    await wait(getBackoffDelayMs(attempt));
  }
}

async function attemptOnce<T>(
  call: () => Promise<CallResult<T>>,
): Promise<{ data: T } | { failure: InvokeFailure; transient: boolean }> {
  try {
    const { data, error } = await call();
    if (!error) {
      return { data: data as T };
    }
    const failure = { message: error.message, status: error.status };
    return { failure, transient: isTransientFailure(failure) };
  } catch (thrown) {
    const failure = { message: thrown instanceof Error ? thrown.message : String(thrown) };
    return { failure, transient: isTransientFailure(null, thrown) };
  }
}

export function isImageLinkExpired(
  expiresAt: string | null | undefined,
  nowMs = Date.now(),
  skewMs = 5000,
): boolean {
  if (!expiresAt) {
    return true;
  }

  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) {
    return true;
  }

  return expiresMs <= nowMs + Math.max(0, skewMs);
}

export async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
