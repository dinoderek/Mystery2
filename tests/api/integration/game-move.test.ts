import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  API_URL,
  ensureMockBlueprintSeeded,
  MOCK_BLUEPRINT_ID,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./auth-helpers";

describe("game-move endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-move");
    await ensureMockBlueprintSeeded();
  });

  afterEach(async () => {
    await auth.cleanup();
  });

  const admin = createClient(
    process.env.SUPABASE_URL || "http://127.0.0.1:54331",
    process.env.SERVICE_ROLE_KEY ??
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

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
      body: JSON.stringify({ game_id, destination: "Living Room" }),
    });

    expect(moveRes.status).toBe(200);
    const data = await moveRes.json();

    expect(data.current_location).toBe("Living Room");
    expect(data.time_remaining).toBe(9);
    expect(data.narration_parts[0].text).toContain("[Mock]");
    expect(data.visible_characters).toContainEqual({
      first_name: "Bob",
      last_name: "Jones",
      sex: "male",
    });
    expect(data.narration_parts[0]).toMatchObject({
      image_id: "mock-location-living-room-123e4567-e89b-12d3-a456-426614174223",
      speaker: {
        kind: "narrator",
        key: "narrator",
        label: "Narrator",
      },
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
      body: JSON.stringify({ game_id, destination: "Living Room" }),
    });
    expect(firstMoveRes.status).toBe(200);

    const secondMoveRes = await fetch(`${API_URL}/game-move`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id, destination: "Kitchen" }),
    });
    expect(secondMoveRes.status).toBe(200);
    const secondMoveData = await secondMoveRes.json();
    expect(secondMoveData.current_location).toBe("Kitchen");
    expect(secondMoveData.time_remaining).toBe(8);
    expect(secondMoveData.narration_parts[0].speaker.kind).toBe("narrator");
    expect(secondMoveData.visible_characters).toContainEqual({
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

    await admin.from("game_sessions").update({ time_remaining: 1 }).eq("id", game_id);

    const moveRes = await fetch(`${API_URL}/game-move`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id, destination: "Living Room" }),
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

    const { data: events, error } = await admin
      .from("game_events")
      .select("sequence,event_type,payload,narration_parts")
      .eq("session_id", game_id)
      .order("sequence", { ascending: true });
    expect(error).toBeNull();

    const moveEvent = events?.find((entry) => entry.event_type === "move");
    const forcedEvent = events?.find((entry) => entry.event_type === "forced_endgame");
    expect(moveEvent).toBeDefined();
    expect(forcedEvent).toBeDefined();
    expect(forcedEvent?.sequence).toBeGreaterThan(moveEvent?.sequence ?? 0);
    expect(forcedEvent?.payload?.trigger).toBe("timeout");
    expect(moveEvent?.narration_parts).toHaveLength(1);
    expect(forcedEvent?.narration_parts).toHaveLength(1);
  });
});
