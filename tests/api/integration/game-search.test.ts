import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { API_URL, setupApiTestAuth, type ApiAuthContext } from "./auth-helpers";

describe("game-search endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-search");
  });

  afterEach(async () => {
    await auth.cleanup();
  });

  it("narrates search with narrator speaker and decreases time", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });
    const { game_id } = await startRes.json();

    const searchRes = await fetch(`${API_URL}/game-search`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id }),
    });

    expect(searchRes.status).toBe(200);
    const data = await searchRes.json();

    expect(data.discovered_clue_id).toBeUndefined();
    expect(data.time_remaining).toBe(9);
    expect(data.narration).toContain("[Mock]");
    expect(data.mode).toBe("explore");
    expect(data.speaker).toMatchObject({
      kind: "narrator",
      key: "narrator",
      label: "Narrator",
    });

    const searchRes2 = await fetch(`${API_URL}/game-search`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id }),
    });
    const data2 = await searchRes2.json();
    expect(data2.discovered_clue_id).toBeUndefined();
    expect(data2.time_remaining).toBe(8);
    expect(data2.narration).toContain("[Mock]");
    expect(data2.speaker.kind).toBe("narrator");
  });
});
