// The engine's boundary against its host platform.
//
// Endpoint handlers and shared helpers reach the outside world only through a
// context. There are two: `EngineContext` for a handler that runs as a
// profile, and `CatalogContext` — content only — for one that does not.
// Nothing below this file knows where the game's state is kept;
// `context-local.ts` is the implementation, over SQLite and the filesystem.
// Keeping the surface narrow — ~15 named operations, not a query builder — is
// what would let the state live somewhere else without touching a line of game
// logic.
//
// Error convention, uniform across every method: a genuine backend failure
// throws, and "the thing does not exist" is a `null`/empty return. Handlers
// therefore map a thrown error to 500 and a null to 404/400.

import type { ClueGraphCase } from "../../shared/src/clue-graph-schema.ts";
import type { PlayableBlueprint, MsfCaseFile } from "../../shared/src/msf-case.ts";
import type { SceneManifest } from "../../shared/src/scene-schema.ts";
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
  msf_snapshot?: MsfCaseFile;
  /** The validated clue-graph case the game started with: resume and every turn play this, not today's file. */
  clue_graph_snapshot?: ClueGraphCase;
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
  /** The age the game is narrated for; null for a game saved before games had one. */
  reading_age: number | null;
  created_at: string;
  updated_at: string;
}

/** The subset of session columns the catalog endpoint reads. */
export interface GameSessionSummaryRow {
  msf_title?: string;
  clue_graph_title?: string;
  /** The saved clue-graph snapshot's format, when there is one: an old one cannot be opened. */
  clue_graph_format?: string;
  id: string;
  blueprint_id: string;
  mode: GameMode;
  time_remaining: number;
  outcome: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewGameSession {
  msf_snapshot?: MsfCaseFile;
  clue_graph_snapshot?: ClueGraphCase;
  player_id: string;
  blueprint_id: string;
  ai_profile_id: string;
  mode: GameMode;
  current_location_id: string;
  time_remaining: number;
  /** The age the game is narrated for, fixed for its whole life. */
  reading_age: number;
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

/** An event to save: the save assigns its session and sequence. */
export type SaveEvent = Omit<NewGameEvent, "session_id" | "sequence">;

/** One turn's whole write: the session change and the events it produced. */
export interface TurnSave {
  game_id: string;
  /**
   * The sequence the turn expects its first event to take, one past the last
   * event it read. Events take consecutive numbers from here.
   */
  expected_sequence: number;
  /** Inserts the session, under `game_id`, before the events: a game's first save. */
  start?: NewGameSession;
  patch?: GameSessionPatch;
  events: SaveEvent[];
}

export interface SessionStore {
  /** Returns null when no session with that id is visible to the player. */
  getById(gameId: string): Promise<GameSessionRow | null>;
  create(session: NewGameSession): Promise<string>;
  update(gameId: string, patch: GameSessionPatch): Promise<void>;
  /**
   * Writes a turn's session change and events in one transaction. Throws
   * `SaveConflictError`, writing nothing, when the game's events no longer
   * end just before `expected_sequence`; any other failure also writes nothing.
   */
  saveTurn(save: TurnSave): Promise<void>;
  /** Every session visible to the player, for the catalog endpoint. */
  listForPlayer(): Promise<GameSessionSummaryRow[]>;
}

/**
 * The playing profile's own settings, bound to its id like `SessionStore`: a
 * handler can read and change only the profile it runs as.
 */
export interface ProfileStore {
  /** The age this profile's new games start at; null when each reads at its case's own. */
  getReadingAge(): Promise<number | null>;
  /** Sets the age, or clears it with null. Throws on an age outside the allowed range. */
  setReadingAge(age: number | null): Promise<void>;
}

export interface EventStore {
  /** Full event history for a session, ordered by ascending sequence. */
  listBySession(gameId: string): Promise<GameEventRow[]>;
  /** One past the highest existing sequence; 1 when the session has no events. */
  nextSequence(gameId: string): Promise<number>;
  insert(event: NewGameEvent): Promise<void>;
}

export interface BlueprintSummaryEntry {
  blueprint: PlayableBlueprint;
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
  loadBlueprint(blueprintId: string, logger: LogWriter): Promise<PlayableBlueprint | null>;
  /** Optional public artwork; missing returns null, invalid content throws. */
  loadScenes(blueprint: PlayableBlueprint): Promise<SceneManifest | null>;
}

/** Resolved AI runtime profile, including the provider secret. */
export interface EngineAIProfile {
  id: string;
  provider: "mock" | "openrouter" | "claude-cli";
  model: string;
  openrouter_api_key: string | null;
}

/** Canonical profile a session uses when the request names none. */
export const DEFAULT_AI_PROFILE_ID = "default";

export interface AIProfileStore {
  /** Returns null when no profile with that id is configured. */
  getById(profileId: string): Promise<EngineAIProfile | null>;
}

/**
 * The AI chosen on the settings page, which `default` resolves to when no run
 * override is in force.
 *
 * App-global rather than player-scoped: the settings page is reachable before a
 * profile is picked, so there is no player to scope to. Synchronous like
 * `PlayerStore`, because it is SQLite and the callers are not endpoint handlers.
 */
export interface AISettingsStore {
  /** The chosen AI's name, or null when nothing has been chosen. */
  getChoice(): string | null;
  /** Stores the choice. The caller has checked that it names an AI. */
  setChoice(name: string): void;
}

/**
 * What a handler can reach when it runs without a profile: the shared content
 * catalog, and nothing that belongs to anybody.
 *
 * There is no owned state on it *by construction* — a handler given this
 * cannot forget to scope a query, because it has nothing to query.
 */
export interface CatalogContext {
  content: ContentStore;
}

/**
 * Everything an endpoint handler is allowed to touch outside its own logic,
 * for a handler that runs as a profile.
 *
 * It extends `CatalogContext`, so a handler written against the narrower one
 * also accepts this; the reverse is a type error, which is the point.
 */
export interface EngineContext extends CatalogContext {
  player: EnginePlayer;
  profile: ProfileStore;
  sessions: SessionStore;
  events: EventStore;
  aiProfiles: AIProfileStore;
}
