import { describe, it, expect } from "vitest";

const API_URL = "http://127.0.0.1:54331/functions/v1";

describe("game-get endpoint", () => {
  it("returns 404 for missing or invalid game_id", async () => {
    const res = await fetch(
      `${API_URL}/game-get?game_id=123e4567-e89b-12d3-a456-426614174999`,
      {
        headers: { Authorization: `Bearer ${process.env.ANON_KEY}` },
      },
    );
    expect(res.status).toBe(404);
  });

  it("returns speaker-enriched persisted state and history", async () => {
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
    const startData = await startRes.json();
    const gameId = startData.game_id;

    await fetch(`${API_URL}/game-talk`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id: gameId, character_name: "Alice" }),
    });

    await fetch(`${API_URL}/game-ask`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id: gameId, player_input: "Where were you?" }),
    });

    const getRes = await fetch(`${API_URL}/game-get?game_id=${gameId}`, {
      headers: { Authorization: `Bearer ${process.env.ANON_KEY}` },
    });
    expect(getRes.status).toBe(200);

    const getData = await getRes.json();
    expect(getData.state).toBeDefined();
    expect(getData.state.mode).toBe("talk");
    expect(getData.state.history.length).toBeGreaterThanOrEqual(3);
    expect(getData.state.history[0].event_type).toBe("start");
    expect(getData.state.history[0].speaker).toMatchObject({
      kind: "narrator",
      key: "narrator",
      label: "Narrator",
    });

    const askHistory = getData.state.history.find((entry: { event_type: string }) => entry.event_type === "ask");
    expect(askHistory?.speaker).toMatchObject({
      kind: "character",
      key: "character:alice",
      label: "Alice",
    });

    expect(getData.state.narration_speaker.kind).toBe("character");
    const persistedSystemLines = getData.state.history.filter(
      (entry: { speaker: { kind: string } }) => entry.speaker.kind === "system",
    );
    expect(persistedSystemLines).toHaveLength(0);
  });
});
