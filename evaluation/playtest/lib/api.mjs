// A small client for the game API, playing as one profile.
//
// Signs in the way the browser does (POST /api/player sets the profile
// cookie) and sends that cookie on every call. Retriable AI failures are
// retried a couple of times, as the web store does; anything else comes back
// to the caller as { ok: false } rather than throwing, so a failed turn is
// recorded instead of ending the game.

const RETRIES = 2;
const RETRY_DELAY_MS = 1_000;

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

function createApi(baseUrl, cookie) {
  async function call(method, endpoint, { body, query } = {}) {
    const url = new URL(`${baseUrl}/api/${endpoint}`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);

    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text };
      }
      if (response.ok) return { ok: true, status: response.status, body: payload };

      const retriable = payload?.details?.retriable === true;
      if (!retriable || attempt >= RETRIES) {
        return { ok: false, status: response.status, body: payload };
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  return {
    get: (endpoint, query) => call("GET", endpoint, { query }),
    post: (endpoint, body) => call("POST", endpoint, { body }),
  };
}
