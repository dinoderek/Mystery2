import { describe, it, expect } from "vitest";

const API_URL = "http://127.0.0.1:54331/functions/v1";

describe("game-accuse endpoint", () => {
  it("can accuse correctly and ends game", async () => {
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

    // Accuse Alice (who is culprit in mock)
    const accuseRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANON_KEY}`,
      },
      body: JSON.stringify({ game_id, accused_character_id: "Alice" }),
    });

    expect(accuseRes.status).toBe(200);
    const data = await accuseRes.json();

    expect(data.result).toBe("win");
    expect(data.ground_truth).toBeDefined();
    expect(data.ground_truth.what_happened).toContain("Alice ate the cookies");
    expect(data.narration).toContain("[Mock]");
  });

  it("can accuse incorrectly and ends game", async () => {
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

    // Accuse Bob (who is not culprit)
    const accuseRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANON_KEY}`,
      },
      body: JSON.stringify({ game_id, accused_character_id: "Bob" }),
    });

    expect(accuseRes.status).toBe(200);
    const data = await accuseRes.json();

    expect(data.result).toBe("lose");
    expect(data.ground_truth).toBeDefined();
  });
});
