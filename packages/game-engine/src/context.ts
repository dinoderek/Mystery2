// The engine's boundary against its host platform.
//
// Endpoint handlers and shared helpers reach the outside world only through
// `EngineContext`. Nothing below this file knows where the game's state is
// kept; `context-local.ts` is the implementation, over SQLite and the
// filesystem. Keeping the surface narrow — ~15 named operations, not a query
// builder — is what would let the state live somewhere else without touching
// a line of game logic.
//
// Error convention, uniform across every method: a genuine backend failure
// throws, and "the thing does not exist" is a `null`/empty return. Handlers
// therefore map a thrown error to 500 and a null to 404/400.

import type { BlueprintV2 } from "../../shared/src/blueprint-schema-v2.ts";
import type { AIEnvSettings } from "./ai-settings-env.ts";
import type { LogWriter } from "./logging.ts";
import type { NarrationPart } from "./narration.ts";
import type { GameMode } from "./state-machine.ts";

/** The local profile a request runs as, resolved from its cookie. */
export interface EnginePlayer {
  id: string;
  name?: string;
}

/** A row of `game_sessions`, as every handler expects to read it. */
export interface GameSessionRow {
  id: string;
  player_id: string;
  blueprint_id: string;
  ai_profile_id: string;
  mode: GameMode;
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
  mode: GameMode;
  time_remaining: number;
  outcome: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewGameSession {
  player_id: string;
  blueprint_id: string;
  ai_profile_id: string;
  mode: GameMode;
  current_location_id: string;
  time_remaining: number;
}

/**
 * A partial update to a session. Every field is optional; only the provided
 * ones are written, mirroring the previous `.update({...})` calls.
 */
export interface GameSessionPatch {
  mode?: GameMode;
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

/** Where a key or model row came from, and therefore who may edit it. */
export type AISettingsSource = "env" | "user";

/** A row of `ai_keys`. Carries the secret; never serialise one straight out. */
export interface AIKeyRecord {
  label: string;
  api_key: string;
  source: AISettingsSource;
  created_at: string;
  updated_at: string;
}

/** A row of `ai_models`. */
export interface AIModelRecord {
  label: string;
  model_id: string;
  source: AISettingsSource;
  created_at: string;
  updated_at: string;
}

/** The single `app_settings` row, as stored. Selections may dangle. */
export interface AISettingsRecord {
  ai_mode: "mock" | "openrouter";
  ai_key_label: string | null;
  ai_model_label: string | null;
  updated_at: string;
}

/** A partial update to the settings row. Only provided fields are written. */
export interface AISettingsUpdate {
  ai_mode?: "mock" | "openrouter";
  ai_key_label?: string | null;
  ai_model_label?: string | null;
}

/**
 * The stored settings with their labels looked up.
 *
 * `mode` is what the runtime should actually do; `stored_mode` is what the
 * player last chose. They differ only when a selection dangles — a label the
 * last environment reseed removed — in which case the missing label is reported
 * so the settings page can explain why narration fell back to mock.
 */
export interface ResolvedAISettings {
  mode: "mock" | "openrouter";
  stored_mode: "mock" | "openrouter";
  key: AIKeyRecord | null;
  model: AIModelRecord | null;
  missing_key_label: string | null;
  missing_model_label: string | null;
}

/**
 * Labelled AI keys and models, plus the selection among them.
 *
 * App-global rather than player-scoped: the settings page is reachable before a
 * profile is picked, so there is no player to scope to. Synchronous like
 * `PlayerStore`, because it is SQLite and the callers are not endpoint handlers.
 */
export interface AISettingsStore {
  listKeys(): AIKeyRecord[];
  /** Returns null when no key has that label. */
  getKey(label: string): AIKeyRecord | null;
  listModels(): AIModelRecord[];
  /** Returns null when no model has that label. */
  getModel(label: string): AIModelRecord | null;

  /** Creates or updates a `user` key. Throws when the label belongs to `env`. */
  putKey(label: string, apiKey: string): AIKeyRecord;
  /** Creates or updates a `user` model. Throws when the label belongs to `env`. */
  putModel(label: string, modelId: string): AIModelRecord;
  /** False when nothing had that label. Throws when the row belongs to `env`. */
  deleteKey(label: string): boolean;
  /** False when nothing had that label. Throws when the row belongs to `env`. */
  deleteModel(label: string): boolean;

  /** The settings row, created with its defaults on first read. */
  getSettings(): AISettingsRecord;
  /**
   * Writes the provided fields and returns the result.
   *
   * @throws when a selection names a label that does not exist, or when
   * `openrouter` is asked for without both a key and a model.
   */
  updateSettings(update: AISettingsUpdate): AISettingsRecord;
  /** The settings with labels looked up, and mock substituted for a dangling live choice. */
  resolve(): ResolvedAISettings;
  /** Replaces every `env` row with the environment's, dropping labels it no longer names. */
  replaceEnvRows(env: AIEnvSettings): void;
}

/** Everything an endpoint handler is allowed to touch outside its own logic. */
export interface EngineContext {
  player: EnginePlayer;
  sessions: SessionStore;
  events: EventStore;
  content: ContentStore;
  aiProfiles: AIProfileStore;
}
