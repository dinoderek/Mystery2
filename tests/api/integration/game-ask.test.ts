import { describe, it, expect } from "vitest";

const API_URL = "http://127.0.0.1:54331/functions/v1";

describe("game-ask endpoint", () => {
  it("asks a character about a discovered clue", async () => {
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
    const { game_id, state } = await startRes.json();

    // The starting clue
    const clueId = state.clues[0];

    // Start talk
    await fetch(`${API_URL}/game-talk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANON_KEY}`,
      },
      body: JSON.stringify({ game_id, character_name: "Alice" }),
    });

    // Ask
    const askRes = await fetch(`${API_URL}/game-ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANON_KEY}`,
      },
      body: JSON.stringify({ game_id, clue_id: clueId }),
    });

    expect(askRes.status).toBe(200);
    const data = await askRes.json();

    expect(data.mode).toBe("talk");
    expect(data.current_talk_character).toBe("Alice");
    expect(data.time_remaining).toBe(8);
    expect(data.narration).toContain("[Mock]");
  });
});
