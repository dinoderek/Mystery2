import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { API_URL, setupApiTestAuth, type ApiAuthContext } from "./auth-helpers";

describe("game-get endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-get");
  });

  afterEach(async () => {
    await auth.cleanup();
  });

  it("returns 404 for missing or invalid game_id", async () => {
    const res = await fetch(
      `${API_URL}/game-get?game_id=123e4567-e89b-12d3-a456-426614174999`,
      {
        headers: auth.headers,
      },
    );
    expect(res.status).toBe(404);
  });

  it("retrieves full game state including history", async () => {
    // 1. Start a new game
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });
    const startData = await startRes.json();
    const gameId = startData.game_id;

    // 2. Retrieve game state
    const getRes = await fetch(`${API_URL}/game-get?game_id=${gameId}`, {
      headers: auth.headers,
    });
    expect(getRes.status).toBe(200);

    const getData = await getRes.json();
    expect(getData.state).toBeDefined();
    expect(getData.state.mode).toBe("explore");
    expect(getData.state.clues).toBeUndefined();
    expect(getData.state.history.length).toBe(1);
    expect(getData.state.history[0].event_type).toBe("start");
    expect(getData.state.history[0].actor).toBe("system");
  });
});
