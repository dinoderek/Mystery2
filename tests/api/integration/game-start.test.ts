import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  API_URL,
  REST_URL,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./auth-helpers";

describe("game-start endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-start");
  });

  afterEach(async () => {
    await auth.cleanup();
  });

  async function fetchSessionRow(gameId: string): Promise<{
    ai_profile_id: string;
    current_location_id: string;
  }> {
    const res = await fetch(
      `${REST_URL}/game_sessions?id=eq.${gameId}&select=ai_profile_id,current_location_id`,
      {
        headers: {
          apikey: process.env.ANON_KEY ?? "",
          Authorization: `Bearer ${auth.accessToken}`,
        },
      },
    );
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows).toHaveLength(1);
    return rows[0] as { ai_profile_id: string; current_location_id: string };
  }

  it("starts a game with narrator speaker metadata", async () => {
    const res = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.game_id).toBeDefined();
    expect(data.state).toBeDefined();
    expect(data.state.mode).toBe("explore");
    expect(data.state.location).toBe("Kitchen");
    expect(data.state.time_remaining).toBe(10);
    expect(data.state.narration).toContain("[Mock]");
    expect(data.state.narration_speaker).toMatchObject({
      kind: "narrator",
      key: "narrator",
      label: "Narrator",
    });
    expect(data.state.history).toHaveLength(1);
    expect(data.state.history[0]).toMatchObject({
      event_type: "start",
      speaker: {
        kind: "narrator",
        key: "narrator",
        label: "Narrator",
      },
    });
    expect(await fetchSessionRow(data.game_id)).toMatchObject({
      ai_profile_id: "default",
      current_location_id: "kitchen",
    });
  });

  it("accepts ai_profile and persists it on the session", async () => {
    const res = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
        ai_profile: "mock",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.game_id).toBeDefined();
    expect((await fetchSessionRow(data.game_id)).ai_profile_id).toBe("mock");
  });

  it("rejects unknown ai_profile", async () => {
    const res = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
        ai_profile: "does-not-exist",
      }),
    });

    expect(res.status).toBe(400);
  });
});
