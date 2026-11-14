// The local `EngineContext` — SQLite and the filesystem, assembled.
//
// Handlers see only the interface in `context.ts`, never this file. It is the
// one place that knows the game's state is a SQLite file and its content is a
// pair of directories — which is what makes it the only file that would have
// to change to keep the state somewhere else.

import { createLocalAIProfileStore, loadAIConfig, type LoadedAIConfig } from "./ai-config.ts";
import { createLocalContentStore } from "./content.ts";
import type {
  AIProfileStore,
  AISettingsStore,
  CatalogContext,
  ContentStore,
  EngineContext,
  EnginePlayer,
} from "./context.ts";
import { createAISettingsStore } from "./db/ai-settings.ts";
import { openDatabase, type Db } from "./db/client.ts";
import { createEventStore } from "./db/events.ts";
import { createPlayerStore, type PlayerStore } from "./db/players.ts";
import { createSessionStore } from "./db/sessions.ts";
import type { EnvRecord } from "./env-file.ts";
import {
  resolveBlueprintDirs,
  resolveBlueprintImagesDir,
  resolveDatabasePath,
} from "./paths.ts";

export interface LocalContextDeps {
  db: Db;
  content: ContentStore;
  aiProfiles: AIProfileStore;
}

/**
 * The context one request runs as. Both stores are bound to this player's id,
 * which is what replaces row-level security.
 */
export function createLocalContext(
  player: EnginePlayer,
  deps: LocalContextDeps,
): EngineContext {
  return {
    player,
    sessions: createSessionStore(deps.db, player.id),
    events: createEventStore(deps.db, player.id),
    content: deps.content,
    aiProfiles: deps.aiProfiles,
  };
}

export interface LocalEngineOptions {
  /**
   * Database file. Defaults to `resolveDatabasePath()`, the development
   * database — tests must always pass a path of their own under a temporary
   * directory.
   */
  databasePath?: string;
  repoRoot?: string;
  env?: EnvRecord;
}

/** Everything the server needs, opened once at startup. */
export interface LocalEngine {
  db: Db;
  /** The file `db` was opened from. Scopes the profile cookie to it. */
  databasePath: string;
  players: PlayerStore;
  content: ContentStore;
  aiProfiles: AIProfileStore;
  /**
   * The AI chosen on the settings page. App-global, so it hangs off the engine
   * next to `players` rather than off a request context — the settings page is
   * reachable before a profile is picked.
   */
  aiSettings: AISettingsStore;
  /**
   * `ai.json` and the run override, read once at start. The settings page lists
   * the AIs from it, and its banner reads the same run override `default`
   * resolves to.
   */
  aiConfig: LoadedAIConfig;
  /** Directory image bytes are served from. */
  imagesDir: string;
  contextFor(player: EnginePlayer): EngineContext;
  /** The context an endpoint that runs without a profile is given. */
  catalogContext(): CatalogContext;
  close(): void;
}

/**
 * Opens the engine.
 *
 * @throws AIConfigError when `ai.json` is malformed or the run override names
 * an AI that is missing or broken. It is read before the database is opened,
 * so a server that cannot narrate as asked stops before touching anything.
 */
export function createLocalEngine(
  options: LocalEngineOptions = {},
): LocalEngine {
  const repoRoot = options.repoRoot ?? process.cwd();
  const env = options.env ?? process.env;

  const aiConfig = loadAIConfig({ repoRoot, env });

  const databasePath = options.databasePath ?? resolveDatabasePath(repoRoot, env);
  const db = openDatabase({ path: databasePath });
  const imagesDir = resolveBlueprintImagesDir(repoRoot, env);
  const content = createLocalContentStore({
    blueprintDirs: resolveBlueprintDirs(repoRoot, env),
    imagesDir,
  });
  const aiSettings = createAISettingsStore(db);
  const aiProfiles = createLocalAIProfileStore(aiConfig, aiSettings);

  return {
    db,
    databasePath,
    players: createPlayerStore(db),
    aiSettings,
    aiConfig,
    content,
    aiProfiles,
    imagesDir,
    contextFor: (player) => createLocalContext(player, { db, content, aiProfiles }),
    catalogContext: () => ({ content }),
    close: () => db.close(),
  };
}
