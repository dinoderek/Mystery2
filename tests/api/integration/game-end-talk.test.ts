import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  API_URL,
  ensureMockBlueprintSeeded,
  MOCK_BLUEPRINT_ID,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./auth-helpers";

describe("game-end-talk endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-end-talk");
    await ensureMockBlueprintSeeded();
  });

  afterEach(async () => {
    await auth.cleanup();
  });

  it("ends the conversation and returns narrator speaker", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
      }),
    });
    expect(startRes.status).toBe(200);
    const { game_id } = await startRes.json();

    const talkRes = await fetch(`${API_URL}/game-talk`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id, character_name: "Alice" }),
    });
    expect(talkRes.status).toBe(200);

    const endRes = await fetch(`${API_URL}/game-end-talk`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id }),
    });

    expect(endRes.status).toBe(200);
    const data = await endRes.json();

    expect(data.mode).toBe("explore");
    expect(data.current_talk_character).toBeNull();
    expect(data.time_remaining).toBe(10);
    expect(data.narration_parts[0]).toMatchObject({
      speaker: {
        kind: "narrator",
        key: "narrator",
        label: "Narrator",
      },
    });
    expect(data.narration_parts[0].text).toContain("[Mock]");
  });
});
