import { describe, it, expect } from "vitest";

const API_URL = "http://127.0.0.1:54331/functions/v1";

describe("game-end-talk endpoint", () => {
  it("ends the conversation and returns to explore mode without decrementing time", async () => {
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

    // Start talk
    await fetch(`${API_URL}/game-talk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANON_KEY}`,
      },
      body: JSON.stringify({ game_id, character_name: "Alice" }),
    });

    // End talk
    const endRes = await fetch(`${API_URL}/game-end-talk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANON_KEY}`,
      },
      body: JSON.stringify({ game_id }),
    });

    expect(endRes.status).toBe(200);
    const data = await endRes.json();

    expect(data.mode).toBe("explore");
    expect(data.current_talk_character).toBeNull();
    expect(data.time_remaining).toBe(9); // Same as after start-talk
    expect(data.narration).toContain("[Mock]");
  });
});
