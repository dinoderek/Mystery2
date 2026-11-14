// Trace normalization: turn raw database rows into the canonical *raw* trace
// artifact that the trace-evaluation pipeline consumes.
//
// "Raw" is deliberate. This artifact is a faithful dump of what was persisted
// for the played session — session snapshot, the ordered event log, the
// driving blueprint, and non-secret AI-profile metadata. It carries NO derived
// or reconstructed fields: per-turn context reconstruction is a run-time step
// (see reconstruct.ts), not something baked into stored data, so the
// reconstruction logic stays versioned with the code rather than frozen into
// old artifacts.
//
// This module is pure (no I/O). The database read lives in datasource.ts and
// the command that judges a game in ../judge-game.ts, which keeps this
// normalization unit-testable without a database.

import type { BlueprintContext } from "../../../packages/game-engine/src/ai-context.ts";
import { playedEvents } from "../../lib/game-events.ts";

export const TRACE_SCHEMA_VERSION = "trace/0.1";

export type Payload = Record<string, unknown>;

/** One game event as the trace stores it. */
export interface RawEvent {
  id: string | null;
  sequence: number;
  event_type: string;
  actor: string;
  payload: Payload | null;
  narration: string;
  narration_parts: unknown[];
  clues_revealed: string[];
  /** Model that produced the narration; null for non-AI events. */
  model: string | null;
  created_at: string | null;
}

export interface RawSession {
  id: string;
  blueprint_id: string;
  ai_profile_id: string | null;
  mode: string;
  current_location_id: string | null;
  current_talk_character_id: string | null;
  time_remaining: number | null;
  discovered_clues: unknown[];
  outcome: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface TraceProvenance {
  kind: string;
  database?: string | null;
  [key: string]: unknown;
}

/** The stored trace: what was persisted for one played session, and nothing derived. */
export interface RawTrace {
  schema_version: string;
  extracted_at: string;
  source: TraceProvenance;
  session: RawSession;
  ai_profile: Record<string, unknown> | null;
  blueprint: BlueprintContext;
  events: RawEvent[];
}

// Fields we copy off an AI profile. Deliberately excludes openrouter_api_key
// and anything else secret — a trace artifact is meant to be shareable.
const SAFE_PROFILE_FIELDS = ["id", "provider", "model", "label", "mode"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pickSafeProfile(profile: unknown): Record<string, unknown> | null {
  if (!isObject(profile)) return null;
  const safe: Record<string, unknown> = {};
  for (const field of SAFE_PROFILE_FIELDS) {
    if (profile[field] !== undefined && profile[field] !== null) {
      safe[field] = profile[field];
    }
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function normalizeEvent(row: Record<string, unknown>): RawEvent {
  return {
    id: (row.id as string | undefined) ?? null,
    sequence: row.sequence as number,
    event_type: row.event_type as string,
    actor: row.actor as string,
    payload: (row.payload as Payload | null | undefined) ?? null,
    narration: typeof row.narration === "string" ? row.narration : "",
    narration_parts: Array.isArray(row.narration_parts) ? row.narration_parts : [],
    // The runtime persists revealed clues inside payload (revealed_clue_id /
    // revealed_clue_ids), not the clues_revealed column, but we preserve the
    // column too when present so older/seeded rows are not lost.
    clues_revealed: Array.isArray(row.clues_revealed) ? (row.clues_revealed as string[]) : [],
    // Model that produced this event's narration; null for non-AI or pre-0013
    // events.
    model: typeof row.model === "string" ? row.model : null,
    created_at: (row.created_at as string | undefined) ?? null,
  };
}

function normalizeSession(session: Record<string, unknown>): RawSession {
  return {
    id: session.id as string,
    blueprint_id: session.blueprint_id as string,
    ai_profile_id: (session.ai_profile_id as string | undefined) ?? null,
    mode: session.mode as string,
    current_location_id: (session.current_location_id as string | undefined) ?? null,
    current_talk_character_id: (session.current_talk_character_id as string | undefined) ?? null,
    time_remaining: (session.time_remaining as number | undefined) ?? null,
    discovered_clues: Array.isArray(session.discovered_clues) ? session.discovered_clues : [],
    outcome: (session.outcome as string | undefined) ?? null,
    created_at: (session.created_at as string | undefined) ?? null,
    updated_at: (session.updated_at as string | undefined) ?? null,
  };
}

export interface BuildRawTraceInput {
  /** A game_sessions row. */
  session: unknown;
  /** game_events rows, in any order; sorted here by sequence. */
  events: unknown;
  /** The full Blueprint V2 JSON that drove the session. */
  blueprint: unknown;
  /** The AI profile (optional; secrets are stripped). */
  aiProfile?: unknown;
  /** Provenance metadata. */
  source?: TraceProvenance | null;
  /** ISO timestamp; the caller supplies it for determinism. */
  extractedAt?: string | null;
}

/** The canonical raw trace artifact for one session. */
export function buildRawTrace({
  session,
  events,
  blueprint,
  aiProfile = null,
  source = null,
  extractedAt = null,
}: BuildRawTraceInput): RawTrace {
  if (!isObject(session)) {
    throw new Error("buildRawTrace: session row is required");
  }
  if (!Array.isArray(events)) {
    throw new Error("buildRawTrace: events must be an array");
  }
  if (!isObject(blueprint)) {
    throw new Error("buildRawTrace: blueprint JSON is required");
  }

  const orderedEvents = (playedEvents(events) as Record<string, unknown>[])
    .map(normalizeEvent)
    .sort((a, b) => a.sequence - b.sequence);

  return {
    schema_version: TRACE_SCHEMA_VERSION,
    extracted_at: extractedAt ?? new Date().toISOString(),
    source: source ?? { kind: "unknown" },
    session: normalizeSession(session),
    ai_profile: pickSafeProfile(aiProfile),
    blueprint: blueprint as unknown as BlueprintContext,
    events: orderedEvents,
  };
}

// Lightweight shape guard for a raw trace loaded from disk. Throws a readable
// error rather than letting a malformed artifact fail deep in the run.
export function assertRawTrace(trace: unknown): RawTrace {
  if (!isObject(trace)) {
    throw new Error("Raw trace is not an object");
  }
  if (typeof trace.schema_version !== "string") {
    throw new Error("Raw trace missing schema_version");
  }
  if (!isObject(trace.session)) {
    throw new Error("Raw trace missing session");
  }
  if (!isObject(trace.blueprint)) {
    throw new Error("Raw trace missing blueprint");
  }
  if (!Array.isArray(trace.events)) {
    throw new Error("Raw trace missing events array");
  }
  return trace as unknown as RawTrace;
}
