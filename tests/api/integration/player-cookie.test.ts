import { describe, expect, it } from "vitest";

import { API_URL, playerCookie } from "./helpers";

/**
 * The cookie signing in hands the browser.
 *
 * These assert the attributes rather than the round trip, because the failure
 * they guard against is invisible to a client that ignores them: `curl` and the
 * suites store whatever they are sent, so a cookie the browser discards still
 * looks like a working sign-in from here.
 */
describe("the profile cookie", () => {
  async function signIn(): Promise<Response> {
    return fetch(`${API_URL}/player`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `cookie-${crypto.randomUUID().slice(0, 8)}` }),
    });
  }

  it("is not marked Secure over plain http", async () => {
    // SvelteKit marks it `Secure` for every hostname but the literal
    // `localhost`, and a `Secure` cookie is discarded over http — so signing in
    // at the `127.0.0.1` URL `npm run dev` prints appeared to work and then
    // answered 401 to everything.
    const response = await signIn();
    expect(response.ok).toBe(true);

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toMatch(/;\s*Secure/i);
  });

  it("is named for this database, and is HttpOnly and same-site", async () => {
    const response = await signIn();
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(setCookie.startsWith(`${playerCookie()}=`)).toBe(true);
    expect(setCookie).toMatch(/;\s*HttpOnly/i);
    expect(setCookie).toMatch(/;\s*SameSite=Lax/i);
    expect(setCookie).toMatch(/;\s*Path=\//i);
  });
});
