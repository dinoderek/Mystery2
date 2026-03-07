import { describe, it, expect } from "vitest";

const API_URL = "http://127.0.0.1:54331/functions/v1";

describe("game-accuse endpoint", () => {
  it("runs a two-stage accusation flow and resolves to win", async () => {
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ANON_KEY}`,
    };

    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });
    const { game_id } = await startRes.json();

    const accuseStartRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id, accused_character_id: "Alice" }),
    });
    expect(accuseStartRes.status).toBe(200);
    const accuseStartData = await accuseStartRes.json();
    expect(accuseStartData.mode).toBe("accuse");
    expect(accuseStartData.follow_up_prompt).toBeTruthy();
    expect(accuseStartData.result ?? null).toBeNull();

    const accuseRoundOneRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        game_id,
        player_reasoning: "Alice looked suspicious.",
      }),
    });
    expect(accuseRoundOneRes.status).toBe(200);
    const accuseRoundOneData = await accuseRoundOneRes.json();
    expect(accuseRoundOneData.mode).toBe("accuse");
    expect(accuseRoundOneData.follow_up_prompt).toBeTruthy();
    expect(accuseRoundOneData.result ?? null).toBeNull();

    const accuseRoundTwoRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        game_id,
        player_reasoning:
          "Alice had motive and access, and the clues match her timeline.",
      }),
    });
    expect(accuseRoundTwoRes.status).toBe(200);
    const accuseRoundTwoData = await accuseRoundTwoRes.json();
    expect(accuseRoundTwoData.mode).toBe("ended");
    expect(accuseRoundTwoData.result).toBe("win");
  });

  it("resolves to lose for an incorrect suspect", async () => {
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ANON_KEY}`,
    };

    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });
    const { game_id } = await startRes.json();

    await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id, accused_character_id: "Bob" }),
    });

    await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        game_id,
        player_reasoning: "Bob had no alibi.",
      }),
    });

    const resolveRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        game_id,
        player_reasoning: "Final reasoning: Bob is guilty.",
      }),
    });

    expect(resolveRes.status).toBe(200);
    const resolveData = await resolveRes.json();
    expect(resolveData.mode).toBe("ended");
    expect(resolveData.result).toBe("lose");
  });
});
