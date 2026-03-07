import { describe, it, expect } from "vitest";

const API_URL = "http://127.0.0.1:54331/functions/v1";

describe("game-ask endpoint", () => {
  it("requires non-empty player_input", async () => {
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

    // Ask
    const askRes = await fetch(`${API_URL}/game-ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANON_KEY}`,
      },
      body: JSON.stringify({ game_id }),
    });

    expect(askRes.status).toBe(400);
  });

  it("accepts free-form player_input asks and preserves talk continuity", async () => {
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

    await fetch(`${API_URL}/game-talk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANON_KEY}`,
      },
      body: JSON.stringify({ game_id, character_name: "Alice" }),
    });

    const askRes = await fetch(`${API_URL}/game-ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANON_KEY}`,
      },
      body: JSON.stringify({
        game_id,
        player_input: "Where were you when the cookies disappeared?",
      }),
    });

    expect(askRes.status).toBe(200);
    const data = await askRes.json();

    expect(data.mode).toBe("talk");
    expect(data.current_talk_character).toBe("Alice");
    expect(data.time_remaining).toBe(8);
    expect(data.discovered_clue_id).toBeUndefined();
    expect(data.narration).toContain("[Mock]");
  });
});
