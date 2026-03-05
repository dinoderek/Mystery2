import { describe, it, expect } from "vitest";

const API_URL = "http://127.0.0.1:54331/functions/v1";

describe("game-get endpoint", () => {
  it("returns 404 for missing or invalid game_id", async () => {
    const res = await fetch(
      `${API_URL}/game-get?game_id=123e4567-e89b-12d3-a456-426614174999`,
      {
        headers: { Authorization: `Bearer ${process.env.ANON_KEY}` },
      },
    );
    expect(res.status).toBe(404);
  });

  it("retrieves full game state including history", async () => {
    // 1. Start a new game
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANON_KEY}`,
      },
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });
    const startData = await startRes.json();
    const gameId = startData.game_id;

    // 2. Retrieve game state
    const getRes = await fetch(`${API_URL}/game-get?game_id=${gameId}`, {
      headers: { Authorization: `Bearer ${process.env.ANON_KEY}` },
    });
    expect(getRes.status).toBe(200);

    const getData = await getRes.json();
    expect(getData.state).toBeDefined();
    expect(getData.state.mode).toBe("explore");
    expect(getData.state.history.length).toBe(1);
    expect(getData.state.history[0].event_type).toBe("start");
    expect(getData.state.history[0].actor).toBe("system");
  });
});
