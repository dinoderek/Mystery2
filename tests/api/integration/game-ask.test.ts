import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  API_URL,
  ensureMockBlueprintSeeded,
  MOCK_BLUEPRINT_ID,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./auth-helpers";

describe("game-ask endpoint", () => {
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
    auth = await setupApiTestAuth("game-ask");
    await ensureMockBlueprintSeeded();
  });

  afterEach(async () => {
    await auth.cleanup();
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
    expect(data.narration_parts[0].text).toContain("[Mock]");
    expect(data.narration_parts[0]).toMatchObject({
      image_id: "mock-blueprint.character-char-alice.png",
      speaker: {
        kind: "character",
        key: "character:alice",
        label: "Alice",
      },
    });
  });

  it("persists timeout diagnostics for action and forced endgame ordering", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
      }),
    });
    expect(startRes.status).toBe(200);
    const { game_id } = await startRes.json();

    await admin.from("game_sessions").update({ time_remaining: 1 }).eq("id", game_id);

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
        player_input: "Who took the cake?",
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

    const { data: events, error } = await admin
      .from("game_events")
      .select("sequence,event_type,payload,narration_parts")
      .eq("session_id", game_id)
      .order("sequence", { ascending: true });
    expect(error).toBeNull();

    const askEvent = events?.find((entry) => entry.event_type === "ask");
    const forcedEvent = events?.find((entry) => entry.event_type === "forced_endgame");
    const askDiagnostics = askEvent?.payload?.diagnostics;
    const forcedDiagnostics = forcedEvent?.payload?.diagnostics;

    expect(askDiagnostics).toMatchObject({
      event_type: "ask",
      action: "ask",
      event_category: "ask",
      mode: "talk",
      resulting_mode: "accuse",
      time_before: 1,
      time_after: 0,
      time_consumed: true,
      forced_endgame: true,
    });
    expect(forcedDiagnostics).toMatchObject({
      event_type: "forced_endgame",
      action: "ask",
      event_category: "forced_endgame",
      mode: "accuse",
      resulting_mode: "accuse",
      time_before: 0,
      time_after: 0,
      time_consumed: false,
      forced_endgame: true,
      related_sequence: askEvent?.sequence,
    });
    expect(forcedEvent?.sequence).toBeGreaterThan(askEvent?.sequence ?? 0);
    expect(askEvent?.narration_parts).toHaveLength(1);
    expect(forcedEvent?.narration_parts).toHaveLength(1);
  });
});
