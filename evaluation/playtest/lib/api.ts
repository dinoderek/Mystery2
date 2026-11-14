// A small client for the game API, playing as one profile.
//
// Signs in the way the browser does (POST /api/player sets the profile
// cookie) and sends that cookie on every call. Failures are retried by the web
// store's own rule (web/src/lib/domain/store.retry.ts: 5xx, 429, 408 and
// network errors, three attempts, the same backoff). Anything that still fails
// comes back as { ok: false } rather than throwing, so a failed turn is
// recorded instead of losing the game.

import { getBackoffDelayMs, isTransientFailure } from "../../../web/src/lib/domain/store.retry.ts";

const MAX_ATTEMPTS = 3;

/** One answer from the API: the parsed body of a success, or what a failure said. */
export type ApiResponse<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: { error?: string } };

export interface GameApi {
  get<T>(endpoint: string, query?: Record<string, string>): Promise<ApiResponse<T>>;
  post<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>>;
}

export async function signIn(baseUrl: string, name: string): Promise<GameApi> {
  const response = await fetch(`${baseUrl}/api/player`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error(`Sign-in as "${name}" failed: ${response.status} ${await response.text()}`);
  }
  const cookie = response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
  return createApi(baseUrl, cookie);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBody(text: string): { error?: string } {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

interface CallOptions {
  body?: unknown;
  query?: Record<string, string>;
}

function createApi(baseUrl: string, cookie: string): GameApi {
  async function call<T>(method: string, endpoint: string, { body, query }: CallOptions = {}): Promise<ApiResponse<T>> {
    const url = new URL(`${baseUrl}/api/${endpoint}`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);

    for (let attempt = 1; ; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json", cookie },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (error) {
        if (attempt < MAX_ATTEMPTS && isTransientFailure(null, error)) {
          await wait(getBackoffDelayMs(attempt));
          continue;
        }
        return { ok: false, status: 0, body: { error: `request failed: ${(error as Error).message}` } };
      }

      const payload = parseBody(await response.text());
      if (response.ok) return { ok: true, status: response.status, body: payload as T };

      const failure = { status: response.status, message: payload?.error ?? null };
      if (attempt < MAX_ATTEMPTS && isTransientFailure(failure)) {
        await wait(getBackoffDelayMs(attempt));
        continue;
      }
      return { ok: false, status: response.status, body: payload };
    }
  }

  return {
    get: (endpoint, query) => call("GET", endpoint, { query }),
    post: (endpoint, body) => call("POST", endpoint, { body }),
  };
}
