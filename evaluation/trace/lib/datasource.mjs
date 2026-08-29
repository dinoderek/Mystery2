// Local data source for trace extraction.
//
// Isolated from normalization (normalize.mjs) and orchestration (run.mjs) so
// the rest of the pipeline is unit-testable without a database: tests pass a
// fake source object with the same four methods to extractSessionTrace().
//
// This used to hold a service-role Supabase client. The game runs on SQLite and
// the filesystem now, so a "connection" is a file path — which also means a
// trace can be extracted from a copied `game.db` with nothing running.

import path from "node:path";

import { openDatabase } from "../../../packages/game-engine/src/db/client.ts";
import { createLocalContentStore } from "../../../packages/game-engine/src/content.ts";
import { resolveAIProfile } from "../../../packages/game-engine/src/ai-profile.ts";
import {
  resolveBlueprintDirs,
  resolveBlueprintImagesDir,
  resolveDatabasePath,
} from "../../../packages/game-engine/src/paths.ts";
import { buildRawTrace } from "./normalize.mjs";

const SILENT_LOGGER = { log: () => {}, logError: () => {} };

function readJson(value) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Reads sessions straight out of a game database.
 *
 * @param {{ databasePath?: string, repoRoot?: string }} [options]
 *   `databasePath` defaults to the configured game database — pass a copy to
 *   mine a snapshot without touching the live one.
 */
export function createLocalTraceSource({ databasePath = null, repoRoot = null } = {}) {
  const root = repoRoot ?? process.cwd();
  const resolvedPath = databasePath ?? resolveDatabasePath(root, process.env);
  const db = openDatabase({ path: resolvedPath });
  const content = createLocalContentStore({
    blueprintDirs: resolveBlueprintDirs(root, process.env),
    imagesDir: resolveBlueprintImagesDir(root, process.env),
  });

  return {
    databasePath: resolvedPath,

    async fetchSession(sessionId) {
      const row = db
        .prepare("select * from game_sessions where id = ?")
        .get(sessionId);
      if (!row) throw new Error(`Could not load session ${sessionId}: not found`);

      return {
        ...row,
        discovered_clues: readJson(row.discovered_clues) ?? [],
      };
    },

    async fetchEvents(sessionId) {
      return db
        .prepare(
          `select id, sequence, event_type, actor, payload, narration,
                  narration_parts, model, created_at
             from game_events where session_id = ? order by sequence asc`,
        )
        .all(sessionId)
        .map((row) => ({
          ...row,
          payload: readJson(row.payload),
          narration_parts: readJson(row.narration_parts) ?? [],
        }));
    },

    async downloadBlueprint(blueprintId) {
      const blueprint = await content.loadBlueprint(blueprintId, SILENT_LOGGER);
      if (!blueprint) {
        throw new Error(`Could not load blueprint ${blueprintId}: missing`);
      }
      return blueprint;
    },

    async fetchProfile(profileId) {
      // Profile metadata is best-effort; an unconfigured profile must not
      // abort an extraction of a session that used it months ago.
      let profile;
      try {
        profile = resolveAIProfile(profileId, { repoRoot: root });
      } catch {
        return null;
      }
      if (!profile) return null;

      // Never the key — a trace artifact gets shared and committed.
      return { id: profile.id, provider: profile.provider, model: profile.model };
    },

    close() {
      db.close();
    },
  };
}

// Pulls a full session trace through a source (real or fake) and returns the
// canonical raw trace artifact. Pure orchestration over the source's four
// methods — no storage specifics here.
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
    source: {
      kind: "local",
      database: source.databasePath ? path.resolve(source.databasePath) : null,
    },
    extractedAt,
  });
}
