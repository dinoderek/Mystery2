// Public surface of the local game engine.
//
// P3 moves the rest of the engine in here — the shared modules and the endpoint
// handlers currently under `supabase/functions/` — at which point this file
// also exports those. For now it is the local platform adapter only.

export {
  createLocalAIProfileStore,
  resolveAIProfile,
  MOCK_AI_PROFILE_ID,
  type LocalAIProfileOptions,
} from "./ai-profile.ts";
export {
  createLocalContentStore,
  resolveImageFile,
  IMAGE_ROUTE_PREFIX,
  type LocalContentOptions,
} from "./content.ts";
export {
  createLocalContext,
  createLocalEngine,
  type LocalContextDeps,
  type LocalEngine,
  type LocalEngineOptions,
} from "./context-local.ts";
export { DEFAULT_AI_PROFILE_ID } from "./contract.ts";
export type {
  AIProfileStore,
  ContentStore,
  EngineAIProfile,
  EngineContext,
  EnginePlayer,
  EventStore,
  GameEventRow,
  GameSessionPatch,
  GameSessionRow,
  GameSessionSummaryRow,
  NewGameEvent,
  NewGameSession,
  SessionStore,
} from "./contract.ts";
export {
  openDatabase,
  SCHEMA_VERSION,
  type Db,
  type DbStatement,
  type OpenDatabaseOptions,
} from "./db/client.ts";
export { createEventStore } from "./db/events.ts";
export {
  createPlayerStore,
  type PlayerRecord,
  type PlayerStore,
} from "./db/players.ts";
export { createSessionStore } from "./db/sessions.ts";
export { parseEnvFile, readEnvFile, type EnvRecord } from "./env-file.ts";
export {
  resolveBlueprintDirs,
  resolveBlueprintImagesDir,
  resolveDatabasePath,
} from "./paths.ts";
