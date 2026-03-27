import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthenticatedClient } from "../../testkit/src/auth";
import { API_URL, SUPABASE_URL, setupApiTestAuth, type ApiAuthContext } from "./auth-helpers";

describe("RLS ownership policies", () => {
  let userA: ApiAuthContext;
  let userB: ApiAuthContext;

  beforeEach(async () => {
    userA = await setupApiTestAuth("rls-a");
    userB = await setupApiTestAuth("rls-b");
  });

  afterEach(async () => {
    await userA.cleanup();
    await userB.cleanup();
  });

  it("allows owner access and blocks cross-user reads/writes", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: userA.headers,
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });

    expect(startRes.status).toBe(200);
    const { game_id } = await startRes.json();

    const clientA = createAuthenticatedClient(userA.accessToken);
    const clientB = createAuthenticatedClient(userB.accessToken);

    const { data: ownSession, error: ownSessionError } = await clientA
      .from("game_sessions")
      .select("id,user_id")
      .eq("id", game_id)
      .maybeSingle();
    expect(ownSessionError).toBeNull();
    expect(ownSession?.id).toBe(game_id);
    expect(ownSession?.user_id).toBe(userA.user.id);

    const { data: ownEvents, error: ownEventsError } = await clientA
      .from("game_events")
      .select("id")
      .eq("session_id", game_id);
    expect(ownEventsError).toBeNull();
    expect((ownEvents ?? []).length).toBeGreaterThan(0);

    const { data: foreignSessions, error: foreignReadError } = await clientB
      .from("game_sessions")
      .select("id")
      .eq("id", game_id);
    expect(foreignReadError).toBeNull();
    expect(foreignSessions).toEqual([]);

    const { data: foreignUpdateRows, error: foreignUpdateError } = await clientB
      .from("game_sessions")
      .update({ mode: "ended" })
      .eq("id", game_id)
      .select("id");
    expect(foreignUpdateError).toBeNull();
    expect(foreignUpdateRows).toEqual([]);

    const { data: foreignDeleteRows, error: foreignDeleteError } = await clientB
      .from("game_sessions")
      .delete()
      .eq("id", game_id)
      .select("id");
    expect(foreignDeleteError).toBeNull();
    expect(foreignDeleteRows).toEqual([]);

    const { data: foreignEvents, error: foreignEventsError } = await clientB
      .from("game_events")
      .select("id")
      .eq("session_id", game_id);
    expect(foreignEventsError).toBeNull();
    expect(foreignEvents).toEqual([]);

    const { data: ownSessionAfter, error: ownSessionAfterError } = await clientA
      .from("game_sessions")
      .select("id")
      .eq("id", game_id)
      .maybeSingle();
    expect(ownSessionAfterError).toBeNull();
    expect(ownSessionAfter?.id).toBe(game_id);
  });

  it("prevents anonymous reads", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: userA.headers,
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });

    expect(startRes.status).toBe(200);
    const { game_id } = await startRes.json();

    const anonKey = process.env.ANON_KEY ?? "";
    expect(anonKey.length).toBeGreaterThan(0);

    const supabaseUrl = SUPABASE_URL;
    const anonClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: anonSessions, error: anonSessionError } = await anonClient
      .from("game_sessions")
      .select("id")
      .eq("id", game_id);

    expect(anonSessionError).toBeNull();
    expect(anonSessions).toEqual([]);

    const { data: anonEvents, error: anonEventsError } = await anonClient
      .from("game_events")
      .select("id")
      .eq("session_id", game_id);

    expect(anonEventsError).toBeNull();
    expect(anonEvents).toEqual([]);
  });
});
