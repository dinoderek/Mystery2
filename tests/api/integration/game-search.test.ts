import { describe, it, expect } from "vitest";

const API_URL = "http://127.0.0.1:54331/functions/v1";

describe("game-search endpoint", () => {
  it("finds a clue if present and decreases time", async () => {
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

    // Search Kitchen
    const searchRes = await fetch(`${API_URL}/game-search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANON_KEY}`,
      },
      body: JSON.stringify({ game_id }),
    });

    expect(searchRes.status).toBe(200);
    const data = await searchRes.json();

    expect(data.discovered_clue_id).not.toBeNull();
    expect(data.time_remaining).toBe(9);
    expect(data.narration).toContain("[Mock]");

    // Search again -> should return null if no more clues, but Kitchen only has 1 clue "A crumb on the floor."
    // Wait, yes, there's only 1 clue.
    const searchRes2 = await fetch(`${API_URL}/game-search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANON_KEY}`,
      },
      body: JSON.stringify({ game_id }),
    });
    const data2 = await searchRes2.json();
    expect(data2.discovered_clue_id).toBeNull();
    expect(data2.time_remaining).toBe(8);
  });
});
