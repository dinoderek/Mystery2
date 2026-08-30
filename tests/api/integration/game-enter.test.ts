import { beforeEach, describe, expect, it } from "vitest";
import { NARRATOR_SPEAKER } from "../../testkit/src/fixtures";
import {
  API_URL,
  MOCK_BLUEPRINT_ID,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./helpers";

const STARTING_LOCATION_ID = "loc-kitchen";
const STARTING_LOCATION_IMAGE = "mock-blueprint.location-loc-kitchen.png";

describe("game-enter endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-enter");
  });


  async function startGame(): Promise<string> {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ blueprint_id: MOCK_BLUEPRINT_ID }),
    });
    expect(startRes.status).toBe(200);
    const { game_id } = await startRes.json();
    return game_id;
  }

  function enter(game_id: string, headers: Record<string, string> = auth.headers) {
    return fetch(`${API_URL}/game-enter`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id }),
    });
  }

  it("narrates arrival at the starting location without spending a turn", async () => {
    const game_id = await startGame();

    const res = await enter(game_id);

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.mode).toBe("explore");
    expect(data.current_location).toBe(STARTING_LOCATION_ID);
    expect(data.current_talk_character).toBeNull();
    // game-start grants the full budget; entering must not eat into it.
    expect(data.time_remaining).toBe(10);

    expect(data.narration_parts).toHaveLength(1);
    expect(data.narration_parts[0]).toMatchObject({
      speaker: NARRATOR_SPEAKER,
      image_id: STARTING_LOCATION_IMAGE,
    });
    expect(data.narration_parts[0].text).toContain("[Mock]");
  });

  it("persists the arrival as a move event the transcript can replay", async () => {
    const game_id = await startGame();
    expect((await enter(game_id)).status).toBe(200);

    const getRes = await fetch(
      `${API_URL}/game-get?game_id=${encodeURIComponent(game_id)}`,
      { headers: auth.headers },
    );
    expect(getRes.status).toBe(200);
    const { narration_events } = await getRes.json();

    expect(narration_events).toHaveLength(2);
    expect(narration_events[0].event_type).toBe("start");

    const arrival = narration_events[1];
    expect(arrival.event_type).toBe("move");
    // The player confirmed the opening; they never typed a move command, so the
    // replayed transcript must not invent one for them.
    expect(arrival.narration_parts).toHaveLength(1);
    expect(arrival.narration_parts[0].speaker.kind).toBe("narrator");
    expect(arrival.narration_parts[0].image_id).toBe(STARTING_LOCATION_IMAGE);
  });

  it("rejects a second entry so a double confirmation cannot duplicate the page", async () => {
    const game_id = await startGame();
    expect((await enter(game_id)).status).toBe(200);

    const second = await enter(game_id);
    expect(second.status).toBe(400);

    const getRes = await fetch(
      `${API_URL}/game-get?game_id=${encodeURIComponent(game_id)}`,
      { headers: auth.headers },
    );
    const { narration_events } = await getRes.json();
    expect(narration_events).toHaveLength(2);
  });

  it("rejects entry once the player has already acted", async () => {
    const game_id = await startGame();

    const moveRes = await fetch(`${API_URL}/game-move`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id, destination: "loc-living-room" }),
    });
    expect(moveRes.status).toBe(200);

    expect((await enter(game_id)).status).toBe(400);
  });

  it("requires a game_id", async () => {
    const res = await fetch(`${API_URL}/game-enter`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const game_id = await startGame();

    const res = await enter(game_id, { "Content-Type": "application/json" });

    expect(res.status).toBe(401);
  });
});
