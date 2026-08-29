// The local `EngineContext` — SQLite and the filesystem, assembled.
//
// This is the twin of `supabase/functions/_shared/context-supabase.ts`, and
// the two are interchangeable by construction: handlers see only the interface
// in `contract.ts`, so swapping one for the other changes nothing above this
// line. Where the Supabase adapter holds a service-role client, a JWT and two
// storage buckets, this one holds a file handle and two directory paths.

import { createLocalAIProfileStore } from "./ai-profile.ts";
import { createLocalContentStore } from "./content.ts";
import type {
  AIProfileStore,
  ContentStore,
  EngineContext,
  EnginePlayer,
} from "./contract.ts";
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
  players: PlayerStore;
  content: ContentStore;
  aiProfiles: AIProfileStore;
  /** Directory image bytes are served from. */
  imagesDir: string;
  contextFor(player: EnginePlayer): EngineContext;
  close(): void;
}

export function createLocalEngine(
  options: LocalEngineOptions = {},
): LocalEngine {
  const repoRoot = options.repoRoot ?? process.cwd();
  const env = options.env ?? process.env;

  const db = openDatabase({
    path: options.databasePath ?? resolveDatabasePath(repoRoot, env),
  });
  const imagesDir = resolveBlueprintImagesDir(repoRoot, env);
  const content = createLocalContentStore({
    blueprintDirs: resolveBlueprintDirs(repoRoot, env),
    imagesDir,
  });
  const aiProfiles = createLocalAIProfileStore({ repoRoot, env });

  return {
    db,
    players: createPlayerStore(db),
    content,
    aiProfiles,
    imagesDir,
    contextFor: (player) => createLocalContext(player, { db, content, aiProfiles }),
    close: () => db.close(),
  };
}
