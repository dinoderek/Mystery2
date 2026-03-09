import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  API_URL,
  REST_URL,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./auth-helpers";

async function fetchSessionSnapshot(gameId: string, accessToken: string) {
  const res = await fetch(
    `${REST_URL}/game_sessions?id=eq.${gameId}&select=mode,outcome`,
    {
      headers: {
        apikey: process.env.ANON_KEY ?? "",
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  expect(res.status).toBe(200);
  const rows = await res.json();
  expect(rows).toHaveLength(1);
  return rows[0] as { mode: string; outcome: string | null };
}

describe("game-accuse endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-accuse");
  });

  afterEach(async () => {
    await auth.cleanup();
  });

  it("runs a two-stage accusation flow and resolves to win", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });
    const { game_id } = await startRes.json();

    const accuseStartRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id, accused_character_id: "Alice" }),
    });
    expect(accuseStartRes.status).toBe(200);
    const accuseStartData = await accuseStartRes.json();
    expect(accuseStartData.mode).toBe("accuse");
    expect(accuseStartData.follow_up_prompt).toBeTruthy();
    expect(accuseStartData.result ?? null).toBeNull();

    const accuseRoundOneRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers: auth.headers,
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
      headers: auth.headers,
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

    const sessionAfterResolution = await fetchSessionSnapshot(game_id, auth.accessToken);
    expect(sessionAfterResolution.mode).toBe("ended");
    expect(sessionAfterResolution.outcome).toBe("win");

    const accuseAfterEndedRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        game_id,
        player_reasoning: "One more argument after ending.",
      }),
    });
    expect(accuseAfterEndedRes.status).toBe(400);
  });

  it("resolves to lose for an incorrect suspect", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });
    const { game_id } = await startRes.json();

    await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id, accused_character_id: "Bob" }),
    });

    await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        game_id,
        player_reasoning: "Bob had no alibi.",
      }),
    });

    const resolveRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        game_id,
        player_reasoning: "Final reasoning: Bob is guilty.",
      }),
    });

    expect(resolveRes.status).toBe(200);
    const resolveData = await resolveRes.json();
    expect(resolveData.mode).toBe("ended");
    expect(resolveData.result).toBe("lose");

    const sessionAfterResolution = await fetchSessionSnapshot(game_id, auth.accessToken);
    expect(sessionAfterResolution.mode).toBe("ended");
    expect(sessionAfterResolution.outcome).toBe("lose");

    const accuseAfterEndedRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        game_id,
        player_reasoning: "Trying to accuse again after outcome.",
      }),
    });
    expect(accuseAfterEndedRes.status).toBe(400);
  });
});
