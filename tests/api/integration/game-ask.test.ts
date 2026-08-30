import { beforeEach, describe, expect, it } from "vitest";
import { characterSpeaker } from "../../testkit/src/fixtures";
import {
  API_URL,
  MOCK_BLUEPRINT_ID,
  readStoredEvents,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./helpers";

describe("game-ask endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-ask");
  });


  it("requires non-empty player_input", async () => {
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
      body: JSON.stringify({ game_id, character_id: "char-alice" }),
    });
    expect(talkRes.status).toBe(200);

    const askRes = await fetch(`${API_URL}/game-ask`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id }),
    });

    expect(askRes.status).toBe(400);
  });

  it("returns character speaker for talk questions", async () => {
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
      body: JSON.stringify({ game_id, character_id: "char-alice" }),
    });
    expect(talkRes.status).toBe(200);

    const askRes = await fetch(`${API_URL}/game-ask`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        game_id,
        player_input: "Where were you when the cookies disappeared?",
      }),
    });

    expect(askRes.status).toBe(200);
    const data = await askRes.json();

    expect(data.mode).toBe("talk");
    expect(data.current_talk_character).toBe("char-alice");
    expect(data.time_remaining).toBe(9);
    expect(data.discovered_clue_id).toBeUndefined();
    expect(Array.isArray(data.revealed_clues)).toBe(true);
    expect(data.narration_parts[0].text).toContain("[Mock]");
    expect(data.narration_parts[0].image_id).toBeUndefined();
    expect(data.narration_parts[0]).toMatchObject({
      speaker: characterSpeaker("Alice"),
    });
  });

  it("does not consume a turn on ask", async () => {
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
      body: JSON.stringify({ game_id, character_id: "char-alice" }),
    });
    expect(talkRes.status).toBe(200);
    const talkData = await talkRes.json();
    const timeAfterTalk = talkData.time_remaining;

    const askRes = await fetch(`${API_URL}/game-ask`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        game_id,
        player_input: "Who took the cake?",
      }),
    });
    expect(askRes.status).toBe(200);
    const askData = await askRes.json();
    expect(askData.time_remaining).toBe(timeAfterTalk);
    expect(askData.mode).toBe("talk");

    const events = readStoredEvents(game_id);

    const askEvent = events?.find((entry) => entry.event_type === "ask");
    expect(askEvent?.payload?.diagnostics).toMatchObject({
      time_consumed: false,
      forced_endgame: false,
    });
  });
});
