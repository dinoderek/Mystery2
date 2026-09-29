// A small client for the game API, playing as one profile.
//
// Signs in the way the browser does (POST /api/player sets the profile
// cookie) and sends that cookie on every call. Failures are retried by the web
// store's own rule (web/src/lib/domain/store.retry.ts: 5xx, 429, 408 and
// network errors, three attempts, the same backoff). Anything that still fails
// comes back as { ok: false } rather than throwing, so a failed turn is
// recorded instead of losing the game.

import {
  getBackoffDelayMs,
  isTransientFailure,
} from "../../../web/src/lib/domain/store.retry.ts";

const MAX_ATTEMPTS = 3;

export async function signIn(baseUrl, name) {
  const response = await fetch(`${baseUrl}/api/player`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error(`Sign-in as "${name}" failed: ${response.status} ${await response.text()}`);
  }
  const cookie = response.headers.getSetCookie().map((line) => line.split(";")[0]).join("; ");
  return createApi(baseUrl, cookie);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createApi(baseUrl, cookie) {
  async function call(method, endpoint, { body, query } = {}) {
    const url = new URL(`${baseUrl}/api/${endpoint}`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);

    for (let attempt = 1; ; attempt += 1) {
      let response;
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
        return { ok: false, status: 0, body: { error: `request failed: ${error.message}` } };
      }

      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text };
      }
      if (response.ok) return { ok: true, status: response.status, body: payload };

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
