// Trace normalization: turn raw Supabase rows into the canonical *raw* trace
// artifact that the trace-evaluation pipeline consumes.
//
// "Raw" is deliberate. This artifact is a faithful dump of what was persisted
// for the played session — session snapshot, the ordered event log, the
// driving blueprint, and non-secret AI-profile metadata. It carries NO derived
// or reconstructed fields: per-turn context reconstruction is a run-time step
// (see reconstruct.mjs), not something baked into stored data, so the
// reconstruction logic stays versioned with the code rather than frozen into
// old artifacts.
//
// This module is pure (no I/O). The Supabase fetch lives in datasource.mjs and
// the CLI wiring in extract.mjs, which keeps this normalization unit-testable
// without a database.

export const TRACE_SCHEMA_VERSION = "trace/0.1";

// Fields we copy off an AI profile. Deliberately excludes openrouter_api_key
// and anything else secret — a trace artifact is meant to be shareable.
const SAFE_PROFILE_FIELDS = ["id", "provider", "model", "label", "mode"];

function pickSafeProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  const safe = {};
  for (const field of SAFE_PROFILE_FIELDS) {
    if (profile[field] !== undefined && profile[field] !== null) {
      safe[field] = profile[field];
    }
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function normalizeEvent(row) {
  return {
    id: row.id ?? null,
    sequence: row.sequence,
    event_type: row.event_type,
    actor: row.actor,
    payload: row.payload ?? null,
    narration: typeof row.narration === "string" ? row.narration : "",
    narration_parts: Array.isArray(row.narration_parts)
      ? row.narration_parts
      : [],
    // The runtime persists revealed clues inside payload (revealed_clue_id /
    // revealed_clue_ids), not the clues_revealed column, but we preserve the
    // column too when present so older/seeded rows are not lost.
    clues_revealed: Array.isArray(row.clues_revealed) ? row.clues_revealed : [],
    // Model that produced this event's narration; null for non-AI or pre-0013
    // events.
    model: typeof row.model === "string" ? row.model : null,
    created_at: row.created_at ?? null,
  };
}

function normalizeSession(session) {
  return {
    id: session.id,
    blueprint_id: session.blueprint_id,
    ai_profile_id: session.ai_profile_id ?? null,
    mode: session.mode,
    current_location_id: session.current_location_id ?? null,
    current_talk_character_id: session.current_talk_character_id ?? null,
    time_remaining: session.time_remaining ?? null,
    discovered_clues: Array.isArray(session.discovered_clues)
      ? session.discovered_clues
      : [],
    outcome: session.outcome ?? null,
    created_at: session.created_at ?? null,
    updated_at: session.updated_at ?? null,
  };
}

// buildRawTrace({ session, events, blueprint, aiProfile, source, extractedAt })
//   session    — a game_sessions row
//   events     — game_events rows (any order; sorted here by sequence)
//   blueprint  — the full Blueprint V2 JSON that drove the session
//   aiProfile  — the ai_profiles row (optional; secrets are stripped)
//   source     — provenance metadata ({ kind, api_url?, project_ref? })
//   extractedAt — ISO timestamp (optional; caller supplies for determinism)
//
// Returns the canonical raw trace artifact object.
export function buildRawTrace({
  session,
  events,
  blueprint,
  aiProfile = null,
  source = null,
  extractedAt = null,
}) {
  if (!session || typeof session !== "object") {
    throw new Error("buildRawTrace: session row is required");
  }
  if (!Array.isArray(events)) {
    throw new Error("buildRawTrace: events must be an array");
  }
  if (!blueprint || typeof blueprint !== "object") {
    throw new Error("buildRawTrace: blueprint JSON is required");
  }

  const orderedEvents = events
    .map(normalizeEvent)
    .sort((a, b) => a.sequence - b.sequence);

  return {
    schema_version: TRACE_SCHEMA_VERSION,
    extracted_at: extractedAt ?? new Date().toISOString(),
    source: source ?? { kind: "unknown" },
    session: normalizeSession(session),
    ai_profile: pickSafeProfile(aiProfile),
    blueprint,
    events: orderedEvents,
  };
}

// Lightweight shape guard for a raw trace loaded from disk (--trace). Throws a
// readable error rather than letting a malformed artifact fail deep in the
// pipeline.
export function assertRawTrace(trace) {
  if (!trace || typeof trace !== "object") {
    throw new Error("Raw trace is not an object");
  }
  if (typeof trace.schema_version !== "string") {
    throw new Error("Raw trace missing schema_version");
  }
  if (!trace.session || typeof trace.session !== "object") {
    throw new Error("Raw trace missing session");
  }
  if (!trace.blueprint || typeof trace.blueprint !== "object") {
    throw new Error("Raw trace missing blueprint");
  }
  if (!Array.isArray(trace.events)) {
    throw new Error("Raw trace missing events array");
  }
  return trace;
}
