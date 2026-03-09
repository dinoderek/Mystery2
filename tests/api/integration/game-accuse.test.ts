import { describe, it, expect } from "vitest";

const API_URL = "http://127.0.0.1:54331/functions/v1";
const REST_URL = "http://127.0.0.1:54331/rest/v1";

async function fetchSessionSnapshot(gameId: string, anonKey: string) {
  const res = await fetch(
    `${REST_URL}/game_sessions?id=eq.${gameId}&select=mode,outcome,time_remaining`,
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    },
  );

  expect(res.status).toBe(200);
  const rows = await res.json();
  expect(rows).toHaveLength(1);
  return rows[0] as { mode: string; outcome: string | null; time_remaining: number };
}

describe("game-accuse endpoint", () => {
  it("runs a reasoning-first accusation flow and resolves to win", async () => {
    const anonKey = process.env.ANON_KEY ?? "";
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${anonKey}`,
    };

    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });
    const { game_id } = await startRes.json();

    const accuseRoundOneRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        game_id,
        player_reasoning: "I accuse Alice because she had crumbs and no alibi.",
      }),
    });
    expect(accuseRoundOneRes.status).toBe(200);
    const accuseRoundOneData = await accuseRoundOneRes.json();
    expect(accuseRoundOneData.mode).toBe("accuse");
    expect(accuseRoundOneData.follow_up_prompt).toBeTruthy();
    expect(accuseRoundOneData.result ?? null).toBeNull();
    expect(accuseRoundOneData.speaker.kind).toBe("narrator");

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
    expect(accuseRoundTwoData.speaker.kind).toBe("narrator");

    const sessionAfterResolution = await fetchSessionSnapshot(game_id, anonKey);
    expect(sessionAfterResolution.mode).toBe("ended");
    expect(sessionAfterResolution.outcome).toBe("win");

    const accuseAfterEndedRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        game_id,
        player_reasoning: "One more argument after ending.",
      }),
    });
    expect(accuseAfterEndedRes.status).toBe(400);
  });

  it("supports opening accusation mode without initial reasoning", async () => {
    const anonKey = process.env.ANON_KEY ?? "";
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${anonKey}`,
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
      body: JSON.stringify({ game_id }),
    });
    expect(accuseStartRes.status).toBe(200);
    const accuseStartData = await accuseStartRes.json();
    expect(accuseStartData.mode).toBe("accuse");
    expect(accuseStartData.result ?? null).toBeNull();
    expect(accuseStartData.follow_up_prompt).toBeTruthy();
    expect(accuseStartData.speaker.kind).toBe("narrator");

    const roundOneRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        game_id,
        player_reasoning: "I accuse Alice. She panicked when I asked about the cookies.",
      }),
    });
    expect(roundOneRes.status).toBe(200);

    const roundTwoRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        game_id,
        player_reasoning: "The timeline and clues point to Alice.",
      }),
    });
    expect(roundTwoRes.status).toBe(200);
    const roundTwoData = await roundTwoRes.json();
    expect(roundTwoData.mode).toBe("ended");
    expect(roundTwoData.speaker.kind).toBe("narrator");
  });

  it("keeps accusation rounds working after timeout-forced accuse mode", async () => {
    const anonKey = process.env.ANON_KEY ?? "";
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${anonKey}`,
    };

    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });
    const { game_id } = await startRes.json();

    let mode = "explore";
    for (let i = 0; i < 10; i += 1) {
      const searchRes = await fetch(`${API_URL}/game-search`, {
        method: "POST",
        headers,
        body: JSON.stringify({ game_id }),
      });
      expect(searchRes.status).toBe(200);
      const searchData = await searchRes.json();
      mode = searchData.mode;
      if (mode === "accuse") {
        break;
      }
    }

    expect(mode).toBe("accuse");

    const sessionAfterTimeout = await fetchSessionSnapshot(game_id, anonKey);
    expect(sessionAfterTimeout.mode).toBe("accuse");
    expect(sessionAfterTimeout.time_remaining).toBe(0);

    const accuseRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        game_id,
        player_reasoning: "I accuse Alice because the clues match her timeline.",
      }),
    });

    expect(accuseRes.status).toBe(200);
    const accuseData = await accuseRes.json();
    expect(accuseData.mode).toBe("accuse");
    expect(accuseData.follow_up_prompt).toBeTruthy();
    expect(accuseData.speaker.kind).toBe("narrator");
  });

  it("resolves to lose for an incorrect suspect", async () => {
    const anonKey = process.env.ANON_KEY ?? "";
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${anonKey}`,
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
      body: JSON.stringify({
        game_id,
        player_reasoning: "I accuse Bob because he was near the scene.",
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
    expect(resolveData.speaker.kind).toBe("narrator");

    const sessionAfterResolution = await fetchSessionSnapshot(game_id, anonKey);
    expect(sessionAfterResolution.mode).toBe("ended");
    expect(sessionAfterResolution.outcome).toBe("lose");
  });
});
