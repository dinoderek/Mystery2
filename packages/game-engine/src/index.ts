// Public surface of the game engine.
//
// The engine is the game: the state machine, the clue graph, the AI provider
// and prompt assembly, the twelve endpoint handlers, and the SQLite +
// filesystem adapter they run against. What it deliberately does not contain
// is a server — `EngineContext` is handed in, and `web/src/routes/api/` is the
// only thing that knows about HTTP routing, cookies and the process.

// --- the boundary ---
export {
  DEFAULT_AI_PROFILE_ID,
  type AIProfileStore,
  type BlueprintSummaryEntry,
  type ContentStore,
  type EngineAIProfile,
  type EngineContext,
  type EnginePlayer,
  type EventStore,
  type GameEventRow,
  type GameSessionPatch,
  type GameSessionRow,
  type GameSessionSummaryRow,
  type NewGameEvent,
  type NewGameSession,
  type SessionStore,
} from "./context.ts";

// --- the endpoints ---
export {
  ENDPOINTS,
  findEndpoint,
  type EndpointDefinition,
  type EndpointMethod,
} from "./endpoints/index.ts";

// --- the local implementation of the boundary ---
export {
  createLocalContext,
  createLocalEngine,
  type LocalContextDeps,
  type LocalEngine,
  type LocalEngineOptions,
} from "./context-local.ts";
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

// --- helpers the server and the tooling reach for ---
export { ensureCanonicalImageId, buildImageStorageKey } from "./images.ts";
export { createRequestLogger, type LogWriter, type RequestLogger } from "./logging.ts";
export type { NarrationPart } from "./narration.ts";
export { readGameMode, type GameMode } from "./state-machine.ts";
