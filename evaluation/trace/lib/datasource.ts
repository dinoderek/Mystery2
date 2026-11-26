// Local data source for trace extraction.
//
// Isolated from normalization (normalize.ts) and the command (../judge-game.ts)
// so the rest of the run is unit-testable without a database: tests pass a fake
// source object with the same methods to extractSessionTrace(), or an explicit
// database path to createLocalTraceSource().
//
// This is the one evaluation module that resolves the play database path, and
// it opens that database read-only: no directory is created, no schema applied
// and no migration run, so extracting a game from a branch whose schema differs
// leaves the database as it was. A "connection" is a file path, which means a
// trace can be extracted from a copy of `game.db` with nothing running.

import fs from "node:fs";
import path from "node:path";

import { openDatabase } from "../../../packages/game-engine/src/db/client.ts";
import { resolveDatabasePath } from "../../../packages/game-engine/src/paths.ts";
import { buildRawTrace } from "./normalize.ts";
import { buildClueGraphWorld } from "../../../packages/shared/src/clue-graph-case.ts";
import { validateClueGraph } from "../../../packages/shared/src/clue-graph-validator.ts";
import { atReadingAge, gameReadingAge } from "../../../packages/shared/src/reading-age.ts";
import { clueGraphProgress } from "../../../packages/game-engine/src/ai-context.ts";
import type { RawTrace } from "./normalize.ts";

type Row = Record<string, unknown>;

function readJson(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** What extraction reads a played game from. Tests pass a fake with these methods. */
export interface TraceDataSource {
  databasePath?: string | null;
  fetchSession(sessionId: string): Promise<Row>;
  fetchEvents(sessionId: string): Promise<Row[]>;
  close?(): void;
}

export interface LocalTraceSourceOptions {
  /**
   * The database to read. Without one, the play database this checkout's
   * `resolveDatabasePath` names, which only a person running the command may
   * choose: a test passes a path of its own.
   */
  databasePath?: string | null;
  repoRoot?: string | null;
  env?: NodeJS.ProcessEnv;
}

/** Reads sessions straight out of a game database, without writing to it. */
export function createLocalTraceSource({
  databasePath = null,
  repoRoot = null,
  env = process.env,
}: LocalTraceSourceOptions = {}): TraceDataSource {
  const root = repoRoot ?? process.cwd();
  const resolvedPath = databasePath ?? resolveDatabasePath(root, env);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `no game database at ${resolvedPath}. Pass --database <file>, or play a game first: nothing is created to read from.`,
    );
  }
  const db = openDatabase({ path: resolvedPath, readonly: true });

  return {
    databasePath: resolvedPath,

    async fetchSession(sessionId) {
      const row = db.prepare("select * from game_sessions where id = ?").get(sessionId);
      if (!row) throw new Error(`Could not load session ${sessionId}: not found`);

      return {
        ...row,
        discovered_clues: readJson(row.discovered_clues) ?? [],
      };
    },

    async fetchEvents(sessionId) {
      return db
        .prepare(
          // Every column, so a copy from before `request_id` existed reads as it is.
          "select * from game_events where session_id = ? order by sequence asc",
        )
        .all(sessionId)
        .map((row) => ({
          ...row,
          payload: readJson(row.payload),
          narration_parts: readJson(row.narration_parts) ?? [],
        }));
    },

    close() {
      db.close();
    },
  };
}

/** The case at the age the game was narrated for, decided as the engine decides it. */
function playedAt<T extends { metadata: { target_age: number } }>(blueprint: T, readingAge: number | null): T {
  return atReadingAge(blueprint, gameReadingAge(blueprint.metadata.target_age, readingAge));
}

// Pulls a full session trace through a source (real or fake) and returns the
// canonical raw trace artifact. Pure orchestration over the source's methods —
// no storage specifics here.
export async function extractSessionTrace(
  source: TraceDataSource,
  sessionId: string,
  { extractedAt = null }: { extractedAt?: string | null } = {},
): Promise<RawTrace> {
  const session = await source.fetchSession(sessionId);
  const events = await source.fetchEvents(sessionId);
  // A game is judged at the age it was narrated for, saved at its start; an
  // older game, or a database from before games had one, reads at its case's,
  // brought into range as the engine plays it.
  const readingAge = typeof session.reading_age === "number" ? session.reading_age : null;
  // The case a game played is the private snapshot saved at its start, never
  // the file as it is now; its format and what the player had earned by the end
  // go beside it. A game saved without one was not a clue-graph game.
  if (session.clue_graph_snapshot == null) {
    throw new Error(
      `game ${sessionId} played blueprint ${String(session.blueprint_id)}, which is not a clue-graph case: trace reads clue graphs only`,
    );
  }
  const graph = validateClueGraph(JSON.parse(String(session.clue_graph_snapshot)), { story: false });
  const history = events.map((event) => ({
    sequence: event.sequence as number,
    event_type: event.event_type as string,
    actor: event.actor as string,
    narration: typeof event.narration === "string" ? event.narration : "",
    payload: event.payload as Record<string, unknown> | null,
  }));
  return buildRawTrace({
    session,
    events,
    blueprint: playedAt(buildClueGraphWorld(graph), readingAge),
    source: { kind: "local", database: source.databasePath ? path.resolve(source.databasePath) : null },
    extractedAt,
    clueGraph: {
      format: graph.format,
      revision: 1,
      progress: clueGraphProgress(graph, history),
    },
  });
}
