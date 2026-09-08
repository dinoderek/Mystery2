import { beforeEach, describe, expect, it } from "vitest";
import {
  API_URL,
  BASE_URL,
  MOCK_BLUEPRINT_ID,
  seedTestImage,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./helpers";

// The two behaviours, from either side.
//
// A profile is not a wall — the game is one process on the player's own
// machine. It is how one person's cases stay separate from another's, so what
// a missing cookie can reach is exactly what belongs to nobody: the catalog
// and its artwork. Anything that manages or plays a session needs someone to
// be, and there is no way to be them without a cookie naming a profile that
// exists.
// A portrait rather than the cover: `blueprint-images.test.ts` deletes the
// cover to prove a missing file 404s, and suites in a run share one image
// directory. Nothing removes this one.
const REFERENCED_IMAGE_ID = "mock-blueprint.character-char-alice.png";

const NO_PROFILE_HEADERS = { "Content-Type": "application/json" };

const UNKNOWN_PROFILE_HEADERS = {
  "Content-Type": "application/json",
  Cookie: "mystery-player-id=00000000-0000-4000-8000-000000000000",
};

describe("requests without a profile", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("unauthenticated");
    seedTestImage(REFERENCED_IMAGE_ID);
  });

  it("rejects session work with a missing cookie, and with one naming a profile that does not exist", async () => {
    const start = (headers: Record<string, string>) =>
      fetch(`${API_URL}/game-start`, {
        method: "POST",
        headers,
        body: JSON.stringify({ blueprint_id: MOCK_BLUEPRINT_ID }),
      });

    expect((await start(NO_PROFILE_HEADERS)).status).toBe(401);
    // A stale cookie — the profile was removed, or the database was replaced —
    // is signed out, not an error.
    expect((await start(UNKNOWN_PROFILE_HEADERS)).status).toBe(401);
    expect((await start(auth.headers)).status).toBe(200);
  });

  it("rejects every session endpoint, whichever way it is reached", async () => {
    // One per profile-scoped endpoint, so adding one that forgets to run as
    // somebody fails here rather than quietly serving another player's game.
    const sessionEndpoints: ReadonlyArray<readonly [string, "GET" | "POST"]> = [
      ["game-accuse", "POST"],
      ["game-ask", "POST"],
      ["game-end-talk", "POST"],
      ["game-enter", "POST"],
      ["game-get", "GET"],
      ["game-move", "POST"],
      ["game-search", "POST"],
      ["game-sessions-list", "GET"],
      ["game-start", "POST"],
      ["game-talk", "POST"],
    ];

    for (const [name, method] of sessionEndpoints) {
      for (const headers of [NO_PROFILE_HEADERS, UNKNOWN_PROFILE_HEADERS]) {
        const res = await fetch(`${API_URL}/${name}`, {
          method,
          headers,
          ...(method === "POST" ? { body: "{}" } : {}),
        });
        expect(`${name} ${method} -> ${res.status}`).toBe(`${name} ${method} -> 401`);
      }
    }
  });

  it("serves the catalog without a profile", async () => {
    const listed = await fetch(`${API_URL}/blueprints-list`);
    expect(listed.status).toBe(200);

    const anonymous = await listed.json();
    expect(anonymous.blueprints.some((b: { id: string }) => b.id === MOCK_BLUEPRINT_ID)).toBe(
      true,
    );

    // Signing in does not change it: the catalog belongs to nobody, so both
    // callers see the same thing.
    const signedIn = await (
      await fetch(`${API_URL}/blueprints-list`, { headers: auth.headers })
    ).json();
    expect(signedIn).toEqual(anonymous);
  });

  it("serves image bytes without a profile", async () => {
    // The rule left on this route is containment, not access — it serves what
    // the blueprint names and nothing else beside it on disk, and that is
    // `blueprint-images.test.ts`.
    const served = await fetch(`${BASE_URL}/api/images/${MOCK_BLUEPRINT_ID}/${REFERENCED_IMAGE_ID}`);

    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
  });
});
