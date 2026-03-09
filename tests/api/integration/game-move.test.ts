import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { API_URL, setupApiTestAuth, type ApiAuthContext } from "./auth-helpers";

describe("game-move endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-move");
  });

  afterEach(async () => {
    await auth.cleanup();
  });

  it("moves the player and decreases time", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });
    const { game_id } = await startRes.json();

    const moveRes = await fetch(`${API_URL}/game-move`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id, destination: "Living Room" }),
    });

    expect(moveRes.status).toBe(200);
    const data = await moveRes.json();

    expect(data.current_location).toBe("Living Room");
    expect(data.time_remaining).toBe(9);
    expect(data.narration).toContain("[Mock]");
    expect(Array.isArray(data.visible_characters)).toBe(true);
  });
});
