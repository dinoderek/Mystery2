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
    SUPABASE_URL,
    process.env.SERVICE_ROLE_KEY ??
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  it("reveals canonical clues in order and then falls back to flavor-only narration", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
      }),
    });
    const { game_id } = await startRes.json();

    const moveRes = await fetch(`${API_URL}/game-move`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id, destination: "loc-living-room" }),
    });
    expect(moveRes.status).toBe(200);

    const firstSearchRes = await fetch(`${API_URL}/game-search`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id }),
    });

    expect(firstSearchRes.status).toBe(200);
    const firstData = await firstSearchRes.json();
    expect(firstData.time_remaining).toBe(8);
    expect(firstData.narration_parts[0].text).toContain("A wrapper on the sofa.");
    expect(firstData.mode).toBe("explore");
    expect(firstData.narration_parts[0].speaker).toMatchObject({
      kind: "narrator",
      key: "narrator",
      label: "Narrator",
    });

    const secondSearchRes = await fetch(`${API_URL}/game-search`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id }),
    });
    expect(secondSearchRes.status).toBe(200);
    const secondData = await secondSearchRes.json();
    expect(secondData.time_remaining).toBe(7);
    expect(secondData.narration_parts[0].text).toContain("A half-eaten cookie.");
    expect(secondData.narration_parts[0].speaker.kind).toBe("narrator");

    const thirdSearchRes = await fetch(`${API_URL}/game-search`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id }),
    });
    expect(thirdSearchRes.status).toBe(200);
    const thirdData = await thirdSearchRes.json();
    expect(thirdData.time_remaining).toBe(6);
    expect(thirdData.narration_parts[0].text).toContain("discover no new clue");

    const { data: searchEvents, error } = await admin
      .from("game_events")
      .select("payload")
      .eq("session_id", game_id)
      .eq("event_type", "search")
      .order("sequence", { ascending: true });
    expect(error).toBeNull();
    expect(searchEvents?.[0]?.payload).toMatchObject({
      revealed_clue_index: 0,
      revealed_clue_id: "clue-wrapper",
      revealed_clue_text: "A wrapper on the sofa.",
      revealed_clue_ids: ["clue-wrapper"],
    });
    expect(searchEvents?.[1]?.payload).toMatchObject({
      revealed_clue_index: 1,
      revealed_clue_id: "clue-half-eaten",
      revealed_clue_text: "A half-eaten cookie.",
      revealed_clue_ids: ["clue-wrapper", "clue-half-eaten"],
    });
    expect(searchEvents?.[2]?.payload).toMatchObject({
      revealed_clue_index: null,
      revealed_clue_text: null,
      revealed_clue_ids: ["clue-wrapper", "clue-half-eaten"],
    });
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
