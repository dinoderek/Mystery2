import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { API_URL, setupApiTestAuth, type ApiAuthContext } from "./auth-helpers";

describe("game-talk endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-talk");
  });

  afterEach(async () => {
    await auth.cleanup();
  });

  it("starts a conversation with a character", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });
    const { game_id } = await startRes.json();

    const talkRes = await fetch(`${API_URL}/game-talk`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id, character_name: "Alice" }),
    });

    expect(talkRes.status).toBe(200);
    const data = await talkRes.json();

    expect(data.current_talk_character).toBe("Alice");
    expect(data.mode).toBe("talk");
    expect(data.time_remaining).toBe(9);
    expect(data.narration).toContain("[Mock]");
    expect(data.narration).not.toContain("because she was hungry");
  });
});
