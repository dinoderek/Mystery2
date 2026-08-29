// The engine's boundary against its host platform.
//
// Endpoint handlers and shared helpers reach the outside world only through
// `EngineContext`. Nothing below this file knows that Supabase exists: the
// Supabase implementation lives in `context-supabase.ts`, and a local
// (SQLite + filesystem) implementation replaces it when the game moves off
// Supabase. Keeping the surface this narrow is what makes that swap tractable
// — it is ~15 named operations, not a query builder.
//
// Error convention, uniform across every method: a genuine backend failure
// throws, and "the thing does not exist" is a `null`/empty return. Handlers
// therefore map a thrown error to 500 and a null to 404/400, which is what the
// hand-written `{ data, error }` checks did before.

import type { BlueprintV2 } from "./blueprints/blueprint-schema-v2.ts";
import type { LogWriter } from "./logging.ts";
import type { NarrationPart } from "./narration.ts";

/** The authenticated player a request runs as. */
export interface EnginePlayer {
  id: string;
  email?: string;
}

/** A row of `game_sessions`, as every handler expects to read it. */
export interface GameSessionRow {
  id: string;
  user_id: string;
  blueprint_id: string;
  ai_profile_id: string;
  mode: string;
  current_location_id: string;
  current_talk_character_id: string | null;
  time_remaining: number;
  discovered_clues: string[];
  outcome: string | null;
  created_at: string;
  updated_at: string;
}

/** The subset of session columns the catalog endpoint reads. */
export interface GameSessionSummaryRow {
  id: string;
  blueprint_id: string;
  mode: string;
  time_remaining: number;
  outcome: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewGameSession {
  user_id: string;
  blueprint_id: string;
  ai_profile_id: string;
  mode: string;
  current_location_id: string;
  time_remaining: number;
}

/**
 * A partial update to a session. Every field is optional; only the provided
 * ones are written, mirroring the previous `.update({...})` calls.
 */
export interface GameSessionPatch {
  mode?: string;
  current_location_id?: string;
  current_talk_character_id?: string | null;
  time_remaining?: number;
  discovered_clues?: string[];
  outcome?: string | null;
  updated_at?: string;
}

/** A row of `game_events`. */
export interface GameEventRow {
  sequence: number;
  event_type: string;
  actor: string;
  narration: string;
  payload: Record<string, unknown> | null;
  narration_parts: NarrationPart[];
  model: string | null;
  created_at: string;
}

export interface NewGameEvent {
  session_id: string;
  sequence: number;
  event_type: string;
  actor: string;
  payload: Record<string, unknown> | null;
  narration: string;
  narration_parts: NarrationPart[];
  model: string | null;
}

export interface SessionStore {
  /** Returns null when no session with that id is visible to the player. */
  getById(gameId: string): Promise<GameSessionRow | null>;
  create(session: NewGameSession): Promise<string>;
  update(gameId: string, patch: GameSessionPatch): Promise<void>;
  /** Every session visible to the player, for the catalog endpoint. */
  listForPlayer(): Promise<GameSessionSummaryRow[]>;
}

export interface EventStore {
  /** Full event history for a session, ordered by ascending sequence. */
  listBySession(gameId: string): Promise<GameEventRow[]>;
  /** One past the highest existing sequence; 1 when the session has no events. */
  nextSequence(gameId: string): Promise<number>;
  insert(event: NewGameEvent): Promise<void>;
}

export interface BlueprintSummaryEntry {
  blueprint: BlueprintV2;
  /** Storage key / filename the blueprint was read from, for diagnostics. */
  source: string;
}

export interface ContentStore {
  /**
   * Every readable blueprint. Unreadable or schema-invalid entries are skipped
   * rather than failing the call, matching the previous per-file `continue`.
   */
  listBlueprints(logger?: LogWriter): Promise<BlueprintSummaryEntry[]>;
  /** Returns null when the blueprint is missing or unparseable. */
  loadBlueprint(blueprintId: string, logger: LogWriter): Promise<BlueprintV2 | null>;
  /**
   * A URL the browser can fetch the image bytes from, or null when the object
   * is missing. Under Supabase this is a short-lived signed URL.
   */
  imageUrl(storageKey: string, expiresInSeconds: number): Promise<string | null>;
}

/** Resolved AI runtime profile, including the provider secret. */
export interface EngineAIProfile {
  id: string;
  provider: "mock" | "openrouter";
  model: string;
  openrouter_api_key: string | null;
}

/** Canonical profile a session uses when the request names none. */
export const DEFAULT_AI_PROFILE_ID = "default";

export interface AIProfileStore {
  /** Returns null when no profile with that id is configured. */
  getById(profileId: string): Promise<EngineAIProfile | null>;
}

/** Everything an endpoint handler is allowed to touch outside its own logic. */
export interface EngineContext {
  player: EnginePlayer;
  sessions: SessionStore;
  events: EventStore;
  content: ContentStore;
  aiProfiles: AIProfileStore;
}
