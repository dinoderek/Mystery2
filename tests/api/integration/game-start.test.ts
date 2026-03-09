import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { API_URL, setupApiTestAuth, type ApiAuthContext } from "./auth-helpers";

describe("game-start endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-start");
  });

  afterEach(async () => {
    await auth.cleanup();
  });

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
  });
});
