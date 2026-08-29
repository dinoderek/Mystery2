import { beforeEach, describe, expect, it } from "vitest";
import {
  API_URL,
  BASE_URL,
  MOCK_BLUEPRINT_ID,
  seedTestImage,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./helpers";

// What used to be JWT rejection. There is no token any more — a request either
// carries a cookie naming a profile that exists, or it does not.
const COVER_IMAGE_ID = "mock-blueprint.blueprint.png";

const UNKNOWN_PROFILE_HEADERS = {
  "Content-Type": "application/json",
  Cookie: "mystery-player-id=00000000-0000-4000-8000-000000000000",
};

describe("requests without a profile", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("unauthenticated");
    seedTestImage(COVER_IMAGE_ID);
  });

  it("rejects a missing cookie, and a cookie naming a profile that does not exist", async () => {
    const start = (headers: Record<string, string>) =>
      fetch(`${API_URL}/game-start`, {
        method: "POST",
        headers,
        body: JSON.stringify({ blueprint_id: MOCK_BLUEPRINT_ID }),
      });

    expect((await start({ "Content-Type": "application/json" })).status).toBe(401);
    // A stale cookie — the profile was removed, or the database was replaced —
    // is signed out, not an error.
    expect((await start(UNKNOWN_PROFILE_HEADERS)).status).toBe(401);
    expect((await start(auth.headers)).status).toBe(200);

    expect((await fetch(`${API_URL}/blueprints-list`)).status).toBe(401);
    expect(
      (await fetch(`${API_URL}/blueprints-list`, { headers: UNKNOWN_PROFILE_HEADERS })).status,
    ).toBe(401);
    expect((await fetch(`${API_URL}/blueprints-list`, { headers: auth.headers })).status).toBe(
      200,
    );
  });

  it("gates image bytes on a profile", async () => {
    // The URL is derivable, so there is no link endpoint to gate — the bytes
    // route is the gate the private bucket used to be.
    const url = `${BASE_URL}/api/images/${MOCK_BLUEPRINT_ID}/${COVER_IMAGE_ID}`;

    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers: UNKNOWN_PROFILE_HEADERS })).status).toBe(401);

    const served = await fetch(url, { headers: { Cookie: auth.headers.Cookie } });
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
  });
});
