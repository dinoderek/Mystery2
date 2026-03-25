import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  API_URL,
  ensureMockBlueprintSeeded,
  MOCK_BLUEPRINT_ID,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./auth-helpers";

describe("game-talk endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-talk");
    await ensureMockBlueprintSeeded();
  });

  afterEach(async () => {
    await auth.cleanup();
  });

  it("starts a conversation with narrator speaker", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
      }),
    });
    const { game_id } = await startRes.json();

    const talkRes = await fetch(`${API_URL}/game-talk`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id, character_id: "char-alice" }),
    });

    expect(talkRes.status).toBe(200);
    const data = await talkRes.json();

    expect(data.current_talk_character).toBe("char-alice");
    expect(data.mode).toBe("talk");
    expect(data.time_remaining).toBe(10);
    expect(data.narration_parts[0].text).toContain("[Mock]");
    expect(data.narration_parts[0].text).toContain("she");
    expect(data.narration_parts[0].text).not.toContain("because she was hungry");
    expect(data.narration_parts[0]).toMatchObject({
      image_id: "mock-character-alice-123e4567-e89b-12d3-a456-426614174333.png",
      speaker: {
        kind: "narrator",
        key: "narrator",
        label: "Narrator",
      },
    });
  });
});
