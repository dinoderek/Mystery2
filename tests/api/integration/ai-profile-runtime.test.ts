import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  API_URL,
  ensureMockBlueprintSeeded,
  MOCK_BLUEPRINT_ID,
  setupApiTestAuth,
  type ApiAuthContext,
  SUPABASE_URL,
} from "./auth-helpers";
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

function getAdminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

describe("ai profile runtime resolution", () => {
  let auth: ApiAuthContext;
  const createdProfiles = new Set<string>();

  beforeEach(async () => {
    auth = await setupApiTestAuth("ai-profile-runtime");
    await ensureMockBlueprintSeeded();
  });

  afterEach(async () => {
    await auth.cleanup();

    const admin = getAdminClient();
    for (const profileId of createdProfiles) {
      const { error } = await admin.from("ai_profiles").delete().eq("id", profileId);
      expect(error).toBeNull();
    }
    createdProfiles.clear();
  });

  it("applies ai profile changes immediately for active sessions", async () => {
    const admin = getAdminClient();
    const profileId = `runtime-${crypto.randomUUID().slice(0, 8)}`;
    createdProfiles.add(profileId);

    const { error: insertError } = await admin.from("ai_profiles").upsert(
      {
        id: profileId,
        provider: "mock",
        model: "mock/runtime-test",
        openrouter_api_key: null,
      },
      { onConflict: "id" },
    );
    expect(insertError).toBeNull();

    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
        ai_profile: profileId,
      }),
    });
    expect(startRes.status).toBe(200);
    const { game_id: gameId } = await startRes.json();

    const firstSearchRes = await fetch(`${API_URL}/game-search`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id: gameId }),
    });
    expect(firstSearchRes.status).toBe(200);

    // Break the profile record after the session starts; endpoint should fail immediately
    // if it resolves profile details dynamically per request.
    const { error: updateError } = await admin
      .from("ai_profiles")
      .update({ model: "" })
      .eq("id", profileId);
    expect(updateError).toBeNull();

    const secondSearchRes = await fetch(`${API_URL}/game-search`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id: gameId }),
    });
    expect(secondSearchRes.status).toBe(500);
  });
});
