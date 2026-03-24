import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  API_URL,
  ensureMockBlueprintSeeded,
  MOCK_BLUEPRINT_ID,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./auth-helpers";

describe("game-get endpoint", () => {
  let auth: ApiAuthContext;
  const admin = createClient(
    process.env.SUPABASE_URL || "http://127.0.0.1:54331",
    process.env.SERVICE_ROLE_KEY ||
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-get");
    await ensureMockBlueprintSeeded();
  });

  afterEach(async () => {
    await auth.cleanup();
  });

  it("returns 404 for missing or invalid game_id", async () => {
    const res = await fetch(
      `${API_URL}/game-get?game_id=123e4567-e89b-12d3-a456-426614174999`,
      {
        headers: auth.headers,
      },
    );
    expect(res.status).toBe(404);
  });

  it("returns speaker-enriched persisted state and history", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
      }),
    });
    expect(startRes.status).toBe(200);
    const startData = await startRes.json();
    const gameId = startData.game_id;

    const talkRes = await fetch(`${API_URL}/game-talk`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id: gameId, character_id: "char-alice" }),
    });
    expect(talkRes.status).toBe(200);

    const askRes = await fetch(`${API_URL}/game-ask`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id: gameId, player_input: "Where were you?" }),
    });
    expect(askRes.status).toBe(200);

    const getRes = await fetch(`${API_URL}/game-get?game_id=${gameId}`, {
      headers: auth.headers,
    });
    expect(getRes.status).toBe(200);

    const getData = await getRes.json();
    expect(getData.state).toBeDefined();
    expect(getData.state.mode).toBe("talk");
    expect(getData.state.characters).toContainEqual({
      id: "char-alice",
      first_name: "Alice",
      last_name: "Smith",
      location_id: "loc-kitchen",
      sex: "female",
    });
    expect(getData.narration_events.length).toBeGreaterThanOrEqual(3);
    expect(getData.narration_events[0].event_type).toBe("start");
    expect(getData.narration_events[0].narration_parts[0].speaker).toMatchObject({
      kind: "narrator",
      key: "narrator",
      label: "Narrator",
    });
    expect(getData.narration_events[0].narration_parts[1]).toMatchObject({
      speaker: {
        kind: "narrator",
        key: "narrator",
        label: "Narrator",
      },
    });
    expect(getData.narration_events[0].narration_parts[1].text).toContain("You already know:");

    const askEvent = getData.narration_events.find(
      (entry: { event_type: string }) => entry.event_type === "ask",
    );
    expect(askEvent?.narration_parts[0].speaker).toMatchObject({
      kind: "character",
      key: "character:alice",
      label: "Alice",
    });

    const persistedSystemLines = getData.narration_events.flatMap(
      (entry: { narration_parts: Array<{ speaker: { kind: string } }> }) => entry.narration_parts,
    ).filter((entry: { speaker: { kind: string } }) => entry.speaker.kind === "system");
    expect(persistedSystemLines).toHaveLength(0);
  });

  it("returns recovery guidance when transcript history cannot be loaded", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
      }),
    });
    expect(startRes.status).toBe(200);
    const { game_id } = await startRes.json();

    const { error } = await admin
      .from("game_events")
      .update({ narration_parts: [{}], narration: "" })
      .eq("session_id", game_id)
      .eq("event_type", "start");
    expect(error).toBeNull();

    const getRes = await fetch(`${API_URL}/game-get?game_id=${game_id}`, {
      headers: auth.headers,
    });
    expect(getRes.status).toBe(500);

    const payload = await getRes.json();
    expect(payload).toMatchObject({
      error: "Failed to load transcript",
      details: {
        recovery: "Return to the mystery list and reopen the case.",
      },
    });
  });
});
