import { describe, it, expect } from "vitest";

const API_URL = "http://127.0.0.1:54331/functions/v1";

describe("game-start endpoint", () => {
  it("starts a game and returns initial state", async () => {
    const res = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANON_KEY}`,
      },
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.game_id).toBeDefined();
    expect(data.state).toBeDefined();
    expect(data.state.mode).toBe("explore");
    expect(data.state.time_remaining).toBe(10);
    expect(Array.isArray(data.state.clues)).toBe(true);
    expect(data.state.narration).toContain("[Mock]");
  });
});
