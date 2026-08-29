import { beforeEach, describe, expect, it } from "vitest";
import { NARRATOR_SPEAKER } from "../../testkit/src/fixtures";
import {
  API_URL,
  MOCK_BLUEPRINT_ID,
  readStoredSession,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./helpers";

describe("game-start endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-start");
  });


  function fetchSessionAIProfile(gameId: string): string {
    const session = readStoredSession(gameId);
    expect(session).not.toBeNull();
    return session!.ai_profile_id;
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
      summary: "The resident baker; she baked the missing cookies.",
    });
    // Notebook reference data is surfaced on the state, not dumped into narration.
    expect(data.state.premise).toBe("Someone stole the cookies.");
    expect(data.state.mystery_summary).toContain("The cookies vanished");
    expect(data.state.discovered_clues).toEqual([]);
    expect(data.state.locations).toContainEqual({
      id: "loc-kitchen",
      name: expect.any(String),
      summary: "Where the cookies were baked and last seen.",
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
    // The opening now points at the notebook instead of dumping facts inline.
    expect(data.narration_events[0].narration_parts[1].text).toContain("notebook");
    expect(data.narration_events[0].narration_parts[1].text).not.toContain(
      "You already know:",
    );
    expect(fetchSessionAIProfile(data.game_id)).toBe("default");
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
    expect(fetchSessionAIProfile(data.game_id)).toBe("mock");
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
