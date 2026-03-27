import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  API_URL,
  SUPABASE_URL,
  ensureMockBlueprintSeeded,
  MOCK_BLUEPRINT_ID,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./auth-helpers";

describe("game-talk endpoint", () => {
  let auth: ApiAuthContext;
  const admin = createClient(
    SUPABASE_URL,
    process.env.SERVICE_ROLE_KEY ||
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-talk");
    await ensureMockBlueprintSeeded();
  });

  afterEach(async () => {
    await auth.cleanup();
  });

  it("starts a conversation with narrator speaker and consumes a turn", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
      }),
    });
    const { game_id } = await startRes.json();

    const talkRes = await fetch(`${API_URL}/game-talk`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id, character_id: "char-alice" }),
    });

    expect(talkRes.status).toBe(200);
    const data = await talkRes.json();

    expect(data.current_talk_character).toBe("char-alice");
    expect(data.mode).toBe("talk");
    expect(data.time_remaining).toBe(9);
    expect(data.narration_parts[0].text).toContain("[Mock]");
    expect(data.narration_parts[0].text).toContain("she");
    expect(data.narration_parts[0].text).not.toContain("because she was hungry");
    expect(data.narration_parts[0]).toMatchObject({
      image_id: "mock-blueprint.character-char-alice.png",
      speaker: {
        kind: "narrator",
        key: "narrator",
        label: "Narrator",
      },
    });
  });

  it("triggers forced endgame when talk uses last turn", async () => {
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
    const talkData = await talkRes.json();
    expect(talkData.mode).toBe("accuse");
    expect(talkData.time_remaining).toBe(0);
    expect(talkData.follow_up_prompt).toBeTruthy();
    expect(talkData.narration_parts).toHaveLength(2);
    expect(
      talkData.narration_parts.map((part: { speaker: { kind: string } }) => part.speaker.kind),
    ).toEqual(["narrator", "narrator"]);

    const { data: events, error } = await admin
      .from("game_events")
      .select("sequence,event_type,payload,narration_parts")
      .eq("session_id", game_id)
      .order("sequence", { ascending: true });
    expect(error).toBeNull();

    const talkEvent = events?.find((entry) => entry.event_type === "talk");
    const forcedEvent = events?.find((entry) => entry.event_type === "forced_endgame");
    const talkDiagnostics = talkEvent?.payload?.diagnostics;
    const forcedDiagnostics = forcedEvent?.payload?.diagnostics;

    expect(talkDiagnostics).toMatchObject({
      event_type: "talk",
      action: "talk",
      event_category: "talk",
      mode: "explore",
      resulting_mode: "accuse",
      time_before: 1,
      time_after: 0,
      time_consumed: true,
      forced_endgame: true,
    });
    expect(forcedDiagnostics).toMatchObject({
      event_type: "forced_endgame",
      action: "talk",
      event_category: "forced_endgame",
      mode: "accuse",
      resulting_mode: "accuse",
      time_before: 0,
      time_after: 0,
      time_consumed: false,
      forced_endgame: true,
      related_sequence: talkEvent?.sequence,
    });
    expect(forcedEvent?.sequence).toBeGreaterThan(talkEvent?.sequence ?? 0);
    expect(talkEvent?.narration_parts).toHaveLength(1);
    expect(forcedEvent?.narration_parts).toHaveLength(1);
  });
});
