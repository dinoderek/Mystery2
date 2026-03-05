import { describe, it, expect } from "vitest";

const API_URL = "http://127.0.0.1:54331/functions/v1";

describe("game-move endpoint", () => {
  it("moves the player and decreases time", async () => {
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
    const { game_id } = await startRes.json();

    const moveRes = await fetch(`${API_URL}/game-move`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANON_KEY}`,
      },
      body: JSON.stringify({ game_id, destination: "Living Room" }),
    });

    expect(moveRes.status).toBe(200);
    const data = await moveRes.json();

    expect(data.current_location).toBe("Living Room");
    expect(data.time_remaining).toBe(9);
    expect(data.narration).toContain("[Mock]");
    expect(Array.isArray(data.visible_characters)).toBe(true);
  });
});
