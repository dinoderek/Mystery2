// Seed a fully-specified game session + fixed history into the DB so the live
// endpoint rebuilds the exact same context every run. This is what makes the
// endpoint backend deterministic: identical seeded rows -> identical prompt ->
// the only variable is the model behind the session's ai_profile.

import { createClient } from "@supabase/supabase-js";
import { resolveEnv } from "./env.mjs";
import { normalizeHistory } from "./roles.mjs";

function adminClient(env) {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Insert a session matching `given` plus its history rows. Returns the game_id.
 *   blueprint  — parsed blueprint (for blueprint_id)
 *   given      — { mode, location_id, talk_character_id?, time_remaining, discovered_clues?, history? }
 *   aiProfile  — ai_profiles.id to pin the session to (default "default")
 *   userId     — owner (a throwaway test user)
 */
export async function seedSessionWithHistory({ blueprint, given, aiProfile, userId, env = resolveEnv() }) {
  const admin = adminClient(env);

  const { data: session, error: sessionError } = await admin
    .from("game_sessions")
    .insert({
      blueprint_id: blueprint.id,
      mode: given.mode,
      current_location_id: given.location_id,
      current_talk_character_id: given.talk_character_id ?? null,
      time_remaining: given.time_remaining,
      discovered_clues: given.discovered_clues ?? [],
      ai_profile_id: aiProfile ?? "default",
      user_id: userId,
    })
    .select("id")
    .single();
  if (sessionError) {
    throw new Error(`Failed to seed game session: ${sessionError.message}`);
  }
  const gameId = session.id;

  const events = normalizeHistory(given.history).map((entry) => ({
    session_id: gameId,
    sequence: entry.sequence,
    event_type: entry.event_type,
    actor: entry.actor,
    narration: entry.narration,
    // game_events requires a non-empty narration_parts array (migration 0008).
    // The runtime context builder only reads `narration`, so a single part
    // mirroring the text satisfies the constraint without affecting the prompt.
    narration_parts: entry.narration_parts ?? [
      { text: entry.narration, speaker: { kind: "narrator", key: "narrator", label: "Narrator" } },
    ],
    payload: entry.payload,
  }));
  if (events.length > 0) {
    const { error: eventsError } = await admin.from("game_events").insert(events);
    if (eventsError) {
      throw new Error(`Failed to seed game history: ${eventsError.message}`);
    }
  }

  return gameId;
}
