import { beforeEach, describe, expect, it } from "vitest";
import { NARRATOR_SPEAKER } from "../../testkit/src/fixtures";
import {
  API_URL,
  MOCK_BLUEPRINT_ID,
  readStoredEvents,
  setStoredTimeRemaining,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./helpers";

describe("game-move endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-move");
  });



  it("moves the player, decreases time, and returns narrator speaker", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
      }),
    });
    expect(startRes.status).toBe(200);
    const { game_id } = await startRes.json();

    const moveRes = await fetch(`${API_URL}/game-move`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id, destination: "loc-living-room" }),
    });

    expect(moveRes.status).toBe(200);
    const data = await moveRes.json();

    expect(data.current_location).toBe("loc-living-room");
    expect(data.time_remaining).toBe(9);
    expect(data.narration_parts[0].text).toContain("[Mock]");
    expect(data.visible_characters).toContainEqual({
      id: "char-bob",
      first_name: "Bob",
      last_name: "Jones",
      sex: "male",
    });
    expect(data.narration_parts[0]).toMatchObject({
      image_id: "mock-blueprint.location-loc-living-room.png",
      speaker: NARRATOR_SPEAKER,
    });
  });

  it("allows revisiting a location without failing", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
      }),
    });
    expect(startRes.status).toBe(200);
    const { game_id } = await startRes.json();

    const firstMoveRes = await fetch(`${API_URL}/game-move`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id, destination: "loc-living-room" }),
    });
    expect(firstMoveRes.status).toBe(200);

    const secondMoveRes = await fetch(`${API_URL}/game-move`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id, destination: "loc-kitchen" }),
    });
    expect(secondMoveRes.status).toBe(200);
    const secondMoveData = await secondMoveRes.json();
    expect(secondMoveData.current_location).toBe("loc-kitchen");
    expect(secondMoveData.time_remaining).toBe(8);
    expect(secondMoveData.narration_parts[0].speaker.kind).toBe("narrator");
    expect(secondMoveData.visible_characters).toContainEqual({
      id: "char-alice",
      first_name: "Alice",
      last_name: "Smith",
      sex: "female",
    });
  });

  it("persists forced endgame metadata when the final move consumes remaining turns", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
      }),
    });
    expect(startRes.status).toBe(200);
    const { game_id } = await startRes.json();

    setStoredTimeRemaining(game_id, 1);

    const moveRes = await fetch(`${API_URL}/game-move`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id, destination: "loc-living-room" }),
    });
    expect(moveRes.status).toBe(200);
    const moveData = await moveRes.json();
    expect(moveData.mode).toBe("accuse");
    expect(moveData.time_remaining).toBe(0);
    expect(moveData.follow_up_prompt).toBeTruthy();
    expect(moveData.narration_parts).toHaveLength(2);
    expect(
      moveData.narration_parts.map((part: { speaker: { kind: string } }) => part.speaker.kind),
    ).toEqual(["narrator", "narrator"]);

    const events = readStoredEvents(game_id);

    const moveEvent = events?.find((entry) => entry.event_type === "move");
    const forcedEvent = events?.find((entry) => entry.event_type === "forced_endgame");
    expect(moveEvent).toBeDefined();
    expect(forcedEvent).toBeDefined();
    // Each AI-narrated event records the model that produced it (the seeded
    // mock profile model for these tests).
    expect(moveEvent?.model).toBe("mock/runtime-default");
    expect(forcedEvent?.model).toBe("mock/runtime-default");
    expect(forcedEvent?.sequence).toBeGreaterThan(moveEvent?.sequence ?? 0);
    expect(forcedEvent?.payload?.trigger).toBe("timeout");
    expect(moveEvent?.narration_parts).toHaveLength(1);
    expect(forcedEvent?.narration_parts).toHaveLength(1);
  });
});
