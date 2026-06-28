// Supabase data source for trace extraction.
//
// Isolated from normalization (normalize.mjs) and orchestration (run.mjs) so
// the rest of the pipeline is unit-testable without a database: tests pass a
// fake source object with the same four methods to extractSessionTrace().

import { createClient } from "@supabase/supabase-js";

import { resolveApiUrl } from "../../../scripts/worktree-ports.mjs";
import { buildRawTrace } from "./normalize.mjs";

export function createSupabaseTraceSource({ url = null, serviceRoleKey = null } = {}) {
  const resolvedUrl =
    url ?? process.env.SUPABASE_URL ?? process.env.API_URL ?? resolveApiUrl();
  const key = serviceRoleKey ?? process.env.SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "Missing SERVICE_ROLE_KEY — set it in the environment to extract a trace from Supabase.",
    );
  }
  const client = createClient(resolvedUrl, key);

  return {
    url: resolvedUrl,

    async fetchSession(sessionId) {
      const { data, error } = await client
        .from("game_sessions")
        .select("*")
        .eq("id", sessionId)
        .single();
      if (error || !data) {
        throw new Error(`Could not load session ${sessionId}: ${error?.message ?? "not found"}`);
      }
      return data;
    },

    async fetchEvents(sessionId) {
      const { data, error } = await client
        .from("game_events")
        .select("id,sequence,event_type,actor,payload,narration,narration_parts,clues_revealed,model,created_at")
        .eq("session_id", sessionId)
        .order("sequence", { ascending: true });
      if (error) {
        throw new Error(`Could not load events for session ${sessionId}: ${error.message}`);
      }
      return data ?? [];
    },

    async downloadBlueprint(blueprintId) {
      const { data, error } = await client.storage
        .from("blueprints")
        .download(`${blueprintId}.json`);
      if (error || !data) {
        throw new Error(`Could not download blueprint ${blueprintId}: ${error?.message ?? "missing"}`);
      }
      return JSON.parse(await data.text());
    },

    async fetchProfile(profileId) {
      const { data, error } = await client
        .from("ai_profiles")
        .select("id,provider,model,label,mode")
        .eq("id", profileId)
        .maybeSingle();
      if (error) {
        // Profile metadata is best-effort; a missing profile must not abort.
        return null;
      }
      return data ?? null;
    },
  };
}

// Pulls a full session trace through a source (real or fake) and returns the
// canonical raw trace artifact. Pure orchestration over the source's four
// methods — no Supabase specifics here.
export async function extractSessionTrace(source, sessionId, { extractedAt = null } = {}) {
  const session = await source.fetchSession(sessionId);
  const events = await source.fetchEvents(sessionId);
  const blueprint = await source.downloadBlueprint(session.blueprint_id);
  const aiProfile = session.ai_profile_id
    ? await source.fetchProfile(session.ai_profile_id)
    : null;

  return buildRawTrace({
    session,
    events,
    blueprint,
    aiProfile,
    source: { kind: "supabase", api_url: source.url ?? null },
    extractedAt,
  });
}
