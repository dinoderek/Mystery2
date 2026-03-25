export function isLiveAIEnabled(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): boolean {
  const raw = env.AI_LIVE ?? "";
  return raw === "1" || raw.toLowerCase() === "true";
}

export function resolveLiveAILabel(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): string {
  const label = env.AI_LIVE_LABEL?.trim();
  if (label) return label;

  const model = env.AI_MODEL?.trim();
  if (model) return model;

  return "custom";
}

export function getLiveSuiteTitle(base: string): string {
  const label = resolveLiveAILabel();
  return `${base} [ai=${label}]`;
}

function parsePositiveInt(
  raw: string | undefined,
  defaultValue: number,
): number {
  if (!raw) return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(value: string, maxLength = 400): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength)}...(truncated)`;
}

export class LiveAIRetriableExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveAIRetriableExhaustedError";
  }
}

export function getLiveTestTimeoutMs(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): number {
  return parsePositiveInt(env.AI_LIVE_TEST_TIMEOUT_MS, 600_000);
}

export function getLiveRetryMaxAttempts(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): number {
  return parsePositiveInt(env.AI_LIVE_RETRY_MAX_ATTEMPTS, 3);
}

export function getLiveRetryBaseDelayMs(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): number {
  return parsePositiveInt(env.AI_LIVE_RETRY_BASE_DELAY_MS, 2_000);
}

export function getLiveFetchTimeoutMs(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): number {
  return parsePositiveInt(env.AI_LIVE_FETCH_TIMEOUT_MS, 180_000);
}

interface CallLiveEndpointWithRetryArgs {
  apiUrl: string;
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  stepLabel: string;
  expectedStatus?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  fetchTimeoutMs?: number;
}

export async function callLiveEndpointWithRetry<T = Record<string, unknown>>(
  args: CallLiveEndpointWithRetryArgs,
): Promise<T> {
  const expectedStatus = args.expectedStatus ?? 200;
  const maxAttempts = args.maxAttempts ?? getLiveRetryMaxAttempts();
  const baseDelayMs = args.baseDelayMs ?? getLiveRetryBaseDelayMs();
  const fetchTimeoutMs = args.fetchTimeoutMs ?? getLiveFetchTimeoutMs();
  let lastError = "No request attempts were made";
  let exhaustedRetriable = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);

    let response: Response;
    try {
      response = await fetch(`${args.apiUrl}/${args.endpoint}`, {
        method: "POST",
        headers: args.headers,
        body: JSON.stringify(args.body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      const latencyMs = Date.now() - startedAt;

      const isAbort = error instanceof Error && error.name === "AbortError";
      const isSocketError = error instanceof TypeError && /fetch failed|socket|ECONNRESET|ECONNREFUSED/i.test(String(error.cause ?? error.message));

      if (isAbort || isSocketError) {
        const code = isAbort ? "FETCH_TIMEOUT" : "SOCKET_ERROR";
        const desc = isAbort
          ? `request timed out after ${fetchTimeoutMs}ms`
          : `connection error: ${(error as Error).message}`;
        lastError =
          `${args.stepLabel}: status=NETWORK attempt=${attempt}/${maxAttempts} latency_ms=${latencyMs} code=${code} error=${desc}`;
        exhaustedRetriable = true;
        if (attempt < maxAttempts) {
          const backoffMs = computeExponentialBackoff(baseDelayMs, attempt);
          await delay(backoffMs);
          continue;
        }
        break;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const latencyMs = Date.now() - startedAt;
    const text = await response.text();

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = { raw: text };
    }

    if (response.status === expectedStatus) {
      return payload as T;
    }

    const details = payload.details as Record<string, unknown> | undefined;
    const isRetriable = response.status === 503 && details?.retriable === true;
    const code = typeof details?.code === "string" ? details.code : "unknown";
    const message = typeof payload.error === "string"
      ? payload.error
      : "request failed";

    lastError =
      `${args.stepLabel}: status=${response.status} attempt=${attempt}/${maxAttempts} latency_ms=${latencyMs} code=${code} error=${message} body=${truncate(text)}`;
    exhaustedRetriable = isRetriable;

    if (!isRetriable || attempt >= maxAttempts) {
      break;
    }

    const backoffMs = computeExponentialBackoff(baseDelayMs, attempt);
    await delay(backoffMs);
  }

  if (exhaustedRetriable) {
    throw new LiveAIRetriableExhaustedError(lastError);
  }
  throw new Error(lastError);
}

function computeExponentialBackoff(baseMs: number, attempt: number): number {
  const multiplier = Math.max(1, 2 ** (attempt - 1));
  return Math.min(baseMs * multiplier, 30_000);
}
