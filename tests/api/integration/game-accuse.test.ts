import { beforeEach, describe, expect, it } from "vitest";
import {
  API_URL,
  MOCK_BLUEPRINT_ID,
  readStoredSession,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./helpers";

function fetchSessionSnapshot(gameId: string) {
  const session = readStoredSession(gameId);
  expect(session).not.toBeNull();
  return session!;
}

describe("game-accuse endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-accuse");
  });


  it("runs a reasoning-first accusation flow and resolves to win", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
      }),
    });
    const { game_id } = await startRes.json();

    const accuseRoundOneRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers: auth.headers,
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
    expect(accuseRoundOneData.narration_parts[0].speaker.kind).toBe("narrator");

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
    expect(accuseRoundTwoData.narration_parts[0].speaker.kind).toBe("narrator");

    const sessionAfterResolution = fetchSessionSnapshot(game_id);
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

  it("supports opening accusation mode without initial reasoning", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
      }),
    });
    const { game_id } = await startRes.json();

    const accuseStartRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id }),
    });
    expect(accuseStartRes.status).toBe(200);
    const accuseStartData = await accuseStartRes.json();
    expect(accuseStartData.mode).toBe("accuse");
    expect(accuseStartData.result ?? null).toBeNull();
    expect(accuseStartData.follow_up_prompt).toBeTruthy();
    expect(accuseStartData.narration_parts[0].speaker.kind).toBe("narrator");

    const roundOneRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        game_id,
        player_reasoning: "I accuse Alice. She panicked when I asked about the cookies.",
      }),
    });
    expect(roundOneRes.status).toBe(200);

    const roundTwoRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        game_id,
        player_reasoning: "The timeline and clues point to Alice.",
      }),
    });
    expect(roundTwoRes.status).toBe(200);
    const roundTwoData = await roundTwoRes.json();
    expect(roundTwoData.mode).toBe("ended");
    expect(roundTwoData.narration_parts[0].speaker.kind).toBe("narrator");
  });

  it("keeps accusation rounds working after timeout-forced accuse mode", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
      }),
    });
    const { game_id } = await startRes.json();

    let mode = "explore";
    for (let i = 0; i < 10; i += 1) {
      const searchRes = await fetch(`${API_URL}/game-search`, {
        method: "POST",
        headers: auth.headers,
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

    const sessionAfterTimeout = fetchSessionSnapshot(game_id);
    expect(sessionAfterTimeout.mode).toBe("accuse");
    expect(sessionAfterTimeout.time_remaining).toBe(0);

    const accuseRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        game_id,
        player_reasoning: "I accuse Alice because the clues match her timeline.",
      }),
    });

    expect(accuseRes.status).toBe(200);
    const accuseData = await accuseRes.json();
    expect(accuseData.mode).toBe("accuse");
    expect(accuseData.follow_up_prompt).toBeTruthy();
    expect(accuseData.narration_parts[0].speaker.kind).toBe("narrator");
  });

  it("rejects a wrong suspect with encouragement, then resolves to lose from round 3", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
      }),
    });
    const { game_id } = await startRes.json();

    // Rounds 0–2: a wrong accusation is rejected with a retry invitation.
    for (let round = 0; round < 3; round += 1) {
      const roundRes = await fetch(`${API_URL}/game-accuse`, {
        method: "POST",
        headers: auth.headers,
        body: JSON.stringify({
          game_id,
          player_reasoning: "I accuse Bob because he was near the scene.",
        }),
      });
      expect(roundRes.status).toBe(200);
      const roundData = await roundRes.json();
      expect(roundData.mode).toBe("accuse");
      expect(roundData.result).toBeNull();
      expect(roundData.follow_up_prompt).toBeTruthy();
    }

    // Round 3: a still-wrong accusation finally resolves to lose.
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
    expect(resolveData.narration_parts[0].speaker.kind).toBe("narrator");

    const sessionAfterResolution = fetchSessionSnapshot(game_id);
    expect(sessionAfterResolution.mode).toBe("ended");
    expect(sessionAfterResolution.outcome).toBe("lose");
  });
});
