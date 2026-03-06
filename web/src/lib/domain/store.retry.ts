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

export async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
