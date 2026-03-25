import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  API_URL,
  ensureMockBlueprintSeeded,
  MOCK_BLUEPRINT_ID,
  setupApiTestAuth,
  type ApiAuthContext,
} from "../integration/auth-helpers";

describe("Full E2E API Investigation Flow", () => {
  let auth: ApiAuthContext;

  const admin = createClient(
    process.env.SUPABASE_URL || "http://127.0.0.1:54331",
    process.env.SERVICE_ROLE_KEY ??
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  beforeEach(async () => {
    auth = await setupApiTestAuth("api-e2e-flow");
    await ensureMockBlueprintSeeded();
  });

  afterEach(async () => {
    await auth.cleanup();
  });

  async function startGameSession(headers: HeadersInit) {
    const listRes = await fetch(`${API_URL}/blueprints-list`, { headers });
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    const mockBlueprint = listData.blueprints.find(
      (blueprint: { id: string }) => blueprint.id === MOCK_BLUEPRINT_ID,
    );
    if (!mockBlueprint) {
      throw new Error(`Mock blueprint ${MOCK_BLUEPRINT_ID} not found`);
    }
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ blueprint_id: mockBlueprint.id }),
    });
    expect(startRes.status).toBe(200);
    const startData = await startRes.json();
    return startData.game_id as string;
  }

  async function loadNarrationEvents(gameId: string, headers: HeadersInit) {
    const getRes = await fetch(`${API_URL}/game-get?game_id=${gameId}`, {
      headers,
    });
    expect(getRes.status).toBe(200);
    const payload = await getRes.json();
    return payload.narration_events as Array<{
      event_type: string;
      narration_parts: Array<{ text: string; speaker: { kind: string } }>;
    }>;
  }

  it("completes a full investigation from start to correct accusation", async () => {
    const headers = auth.headers;

    const listRes = await fetch(`${API_URL}/blueprints-list`, { headers });
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    const mockBlueprint = listData.blueprints.find(
      (blueprint: { id: string }) => blueprint.id === MOCK_BLUEPRINT_ID,
    );
    if (!mockBlueprint) {
      throw new Error(`Mock blueprint ${MOCK_BLUEPRINT_ID} not found`);
    }
    const blueprintId = mockBlueprint.id;

    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ blueprint_id: blueprintId }),
    });
    expect(startRes.status).toBe(200);
    const { game_id, state, narration_events } = await startRes.json();
    expect(state.mode).toBe("explore");
    expect(narration_events[0].narration_parts[0].speaker.kind).toBe("narrator");

    const moveRes = await fetch(`${API_URL}/game-move`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id, destination: "loc-kitchen" }),
    });
    expect(moveRes.status).toBe(200);
    const moveData = await moveRes.json();
    expect(moveData.narration_parts[0].speaker.kind).toBe("narrator");

    const searchRes = await fetch(`${API_URL}/game-search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id }),
    });
    expect(searchRes.status).toBe(200);
    const searchData = await searchRes.json();
    expect(searchData.narration_parts[0].speaker.kind).toBe("narrator");

    const talkRes = await fetch(`${API_URL}/game-talk`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id, character_id: "char-alice" }),
    });
    expect(talkRes.status).toBe(200);
    const talkData = await talkRes.json();
    expect(talkData.narration_parts[0].speaker.kind).toBe("narrator");

    const askRes = await fetch(`${API_URL}/game-ask`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        game_id,
        player_input: "Where were you when this happened?",
      }),
    });
    expect(askRes.status).toBe(200);
    const askData = await askRes.json();
    expect(askData.narration_parts[0].speaker).toMatchObject({
      kind: "character",
      key: "character:alice",
      label: "Alice",
    });

    const endRes = await fetch(`${API_URL}/game-end-talk`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id }),
    });
    expect(endRes.status).toBe(200);
    const endData = await endRes.json();
    expect(endData.narration_parts[0].speaker.kind).toBe("narrator");

    const getRes = await fetch(`${API_URL}/game-get?game_id=${game_id}`, {
      headers,
    });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.narration_events.length).toBeGreaterThan(0);
    expect(
      getData.narration_events.some(
        (entry: { narration_parts: Array<{ speaker: { kind: string } }> }) =>
          entry.narration_parts.some((part) => part.speaker.kind === "character"),
      ),
    ).toBe(true);

    const accuseStartRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        game_id,
        player_reasoning:
          "I accuse Alice because she was nearby and acted nervous.",
      }),
    });
    expect(accuseStartRes.status).toBe(200);
    const accuseStartData = await accuseStartRes.json();
    expect(accuseStartData.mode).toBe("accuse");
    expect(accuseStartData.narration_parts[0].speaker.kind).toBe("narrator");

    const accuseRoundOneRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        game_id,
        player_reasoning: "Alice was nearby and behaved nervously.",
      }),
    });
    expect(accuseRoundOneRes.status).toBe(200);
    const accuseRoundOneData = await accuseRoundOneRes.json();
    expect(accuseRoundOneData.mode).toBe("ended");
    expect(accuseRoundOneData.result).toBe("win");
    expect(accuseRoundOneData.narration_parts[0].speaker.kind).toBe("narrator");

    const finalGetRes = await fetch(`${API_URL}/game-get?game_id=${game_id}`, {
      headers,
    });
    const finalData = await finalGetRes.json();
    expect(finalData.state.mode).toBe("ended");
    const lastParts = finalData.narration_events.at(-1)?.narration_parts ?? [];
    expect(lastParts.some((p: { speaker: { kind: string } }) => p.speaker.kind === "narrator")).toBe(true);
  });

  it("forces endgame when the final move consumes the last turn", async () => {
    const headers = auth.headers;
    const gameId = await startGameSession(headers);
    await admin
      .from("game_sessions")
      .update({ time_remaining: 1 })
      .eq("id", gameId);

    const moveRes = await fetch(`${API_URL}/game-move`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id: gameId, destination: "loc-kitchen" }),
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

    const narrationEvents = await loadNarrationEvents(gameId, headers);
    const tail = narrationEvents.slice(-2);
    expect(tail.map((event) => event.event_type)).toEqual(["move", "forced_endgame"]);
    expect(tail.map((event) => event.narration_parts[0].text)).toEqual(
      moveData.narration_parts.map((part: { text: string }) => part.text),
    );
  });

  it("forces endgame when the final search consumes the last turn", async () => {
    const headers = auth.headers;
    const gameId = await startGameSession(headers);
    await admin
      .from("game_sessions")
      .update({ time_remaining: 1 })
      .eq("id", gameId);

    const searchRes = await fetch(`${API_URL}/game-search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id: gameId }),
    });
    expect(searchRes.status).toBe(200);
    const searchData = await searchRes.json();

    expect(searchData.mode).toBe("accuse");
    expect(searchData.time_remaining).toBe(0);
    expect(searchData.follow_up_prompt).toBeTruthy();
    expect(searchData.narration_parts).toHaveLength(2);
    expect(
      searchData.narration_parts.map((part: { speaker: { kind: string } }) => part.speaker.kind),
    ).toEqual(["narrator", "narrator"]);

    const narrationEvents = await loadNarrationEvents(gameId, headers);
    const tail = narrationEvents.slice(-2);
    expect(tail.map((event) => event.event_type)).toEqual(["search", "forced_endgame"]);
    expect(tail.map((event) => event.narration_parts[0].text)).toEqual(
      searchData.narration_parts.map((part: { text: string }) => part.text),
    );
  });

  it("forces endgame when the final question consumes the last turn", async () => {
    const headers = auth.headers;
    const gameId = await startGameSession(headers);
    await admin
      .from("game_sessions")
      .update({ time_remaining: 1 })
      .eq("id", gameId);

    const talkRes = await fetch(`${API_URL}/game-talk`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id: gameId, character_id: "char-alice" }),
    });
    expect(talkRes.status).toBe(200);

    const askRes = await fetch(`${API_URL}/game-ask`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        game_id: gameId,
        player_input: "Where were you when this happened?",
      }),
    });
    expect(askRes.status).toBe(200);
    const askData = await askRes.json();

    expect(askData.mode).toBe("accuse");
    expect(askData.time_remaining).toBe(0);
    expect(askData.follow_up_prompt).toBeTruthy();
    expect(askData.narration_parts).toHaveLength(2);
    expect(
      askData.narration_parts.map((part: { speaker: { kind: string } }) => part.speaker.kind),
    ).toEqual(["character", "narrator"]);

    const narrationEvents = await loadNarrationEvents(gameId, headers);
    const tail = narrationEvents.slice(-2);
    expect(tail.map((event) => event.event_type)).toEqual(["ask", "forced_endgame"]);

    // The ask event now includes the player's input as an investigator part
    // prepended to the character's response (for resume fidelity).
    const askEvent = tail[0];
    expect(askEvent.narration_parts[0].speaker.kind).toBe("investigator");
    expect(askEvent.narration_parts[0].text).toBe("Where were you when this happened?");
    // The character response follows the player input
    expect(askEvent.narration_parts[1].text).toBe(askData.narration_parts[0].text);
  });
});
