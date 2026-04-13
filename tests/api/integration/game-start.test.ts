import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NARRATOR_SPEAKER } from "../../testkit/src/fixtures";
import {
  API_URL,
  MOCK_BLUEPRINT_ID,
  REST_URL,
  ensureMockBlueprintSeeded,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./auth-helpers";

describe("game-start endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-start");
    await ensureMockBlueprintSeeded();
  });

  afterEach(async () => {
    await auth.cleanup();
  });

  async function fetchSessionAIProfile(gameId: string): Promise<string> {
    const res = await fetch(
      `${REST_URL}/game_sessions?id=eq.${gameId}&select=ai_profile_id`,
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
    return rows[0].ai_profile_id as string;
  }

  it("starts a game with narrator speaker metadata", async () => {
    const res = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.game_id).toBeDefined();
    expect(data.state).toBeDefined();
    expect(data.state.mode).toBe("explore");
    expect(data.state.time_remaining).toBe(10);
    expect(data.state.current_talk_character).toBeNull();
    expect(data.state.characters).toContainEqual({
      id: "char-alice",
      first_name: "Alice",
      last_name: "Smith",
      location_id: "loc-kitchen",
      sex: "female",
    });
    expect(data.narration_events).toHaveLength(1);
    expect(data.narration_events[0]).toMatchObject({
      event_type: "start",
      narration_parts: [
        {
          speaker: NARRATOR_SPEAKER,
          image_id: "mock-blueprint.blueprint.png",
        },
        {
          speaker: NARRATOR_SPEAKER,
        },
      ],
    });
    expect(data.narration_events[0].narration_parts).toHaveLength(2);
    expect(data.narration_events[0].narration_parts[0].text).toContain("[Mock]");
    expect(data.narration_events[0].narration_parts[1].text).toContain("You already know:");
    expect(data.narration_events[0].narration_parts[1].text).toContain(
      "The mystery:",
    );
    expect(await fetchSessionAIProfile(data.game_id)).toBe("default");
  });

  it("accepts ai_profile and persists it on the session", async () => {
    const res = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
        ai_profile: "mock",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.game_id).toBeDefined();
    expect(await fetchSessionAIProfile(data.game_id)).toBe("mock");
  });

  it("rejects unknown ai_profile", async () => {
    const res = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
        ai_profile: "does-not-exist",
      }),
    });

    expect(res.status).toBe(400);
  });
});
