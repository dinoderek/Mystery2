import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  API_URL,
  ensureMockBlueprintSeeded,
  MOCK_BLUEPRINT_ID,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./auth-helpers";

describe("game-search endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-search");
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

  it("narrates search with narrator speaker and decreases time", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
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
    expect(data.narration_parts[0].text).toContain("[Mock]");
    expect(data.mode).toBe("explore");
    expect(data.narration_parts[0].speaker).toMatchObject({
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
    expect(data2.narration_parts[0].text).toContain("[Mock]");
    expect(data2.narration_parts[0].speaker.kind).toBe("narrator");
  });

  it("persists forced endgame when search consumes the final turn", async () => {
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

    const searchRes = await fetch(`${API_URL}/game-search`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id }),
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

    const { data: events, error } = await admin
      .from("game_events")
      .select("sequence,event_type,payload,narration_parts")
      .eq("session_id", game_id)
      .order("sequence", { ascending: true });
    expect(error).toBeNull();

    const searchEvent = events?.find((entry) => entry.event_type === "search");
    const forcedEvent = events?.find((entry) => entry.event_type === "forced_endgame");
    expect(searchEvent).toBeDefined();
    expect(forcedEvent).toBeDefined();
    expect(forcedEvent?.sequence).toBeGreaterThan(searchEvent?.sequence ?? 0);
    expect(forcedEvent?.payload?.trigger).toBe("timeout");
    expect(searchEvent?.narration_parts).toHaveLength(1);
    expect(forcedEvent?.narration_parts).toHaveLength(1);
  });
});
