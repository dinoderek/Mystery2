import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { API_URL, setupApiTestAuth, type ApiAuthContext } from "./auth-helpers";

describe("game-end-talk endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-end-talk");
  });

  afterEach(async () => {
    await auth.cleanup();
  });

  it("ends the conversation and returns narrator speaker", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });
    const { game_id } = await startRes.json();

    await fetch(`${API_URL}/game-talk`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id, character_name: "Alice" }),
    });

    const endRes = await fetch(`${API_URL}/game-end-talk`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id }),
    });

    expect(endRes.status).toBe(200);
    const data = await endRes.json();

    expect(data.mode).toBe("explore");
    expect(data.current_talk_character).toBeNull();
    expect(data.time_remaining).toBe(9);
    expect(data.narration).toContain("[Mock]");
    expect(data.speaker).toMatchObject({
      kind: "narrator",
      key: "narrator",
      label: "Narrator",
    });
  });
});
