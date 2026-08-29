// The one file in the engine that imports a SQLite driver.
//
// Everything above it — the repositories in this directory, and through them
// the whole engine — sees only the `Db` and `DbStatement` interfaces declared
// here. That containment is deliberate: `node:sqlite` is the intended
// replacement for `better-sqlite3` once it stops emitting
// `ExperimentalWarning: SQLite is an experimental feature`, and when that
// happens it should be a change to this file and nothing else.
//
// The driver is synchronous, which is a fit rather than a compromise: every
// query here is a read of a local file, and the handlers are already `async`
// for the OpenRouter calls, so an async driver would buy nothing.

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { SCHEMA_SQL } from "./schema.ts";

// Required rather than imported, and this is not stylistic. `better-sqlite3`
// is a CommonJS wrapper around a `.node` binary, and it has to stay outside
// any bundle: inlined, its binding loader hits `require.main` in an ES module
// and the server dies at boot. Marking it external is not enough, because the
// engine is a linked workspace package and Vite treats a linked package's
// whole dependency graph as source. A `createRequire` call cannot be analysed
// statically, so the resolution stays where it belongs — at runtime.
const Database = createRequire(import.meta.url)(
  "better-sqlite3",
) as typeof BetterSqlite3;

/** Values SQLite can bind directly. Objects and arrays are JSON-encoded first. */
export type SqlValue = string | number | null;

export interface DbStatement {
  /** The first matching row, or undefined when there is none. */
  get(...params: SqlValue[]): Record<string, unknown> | undefined;
  all(...params: SqlValue[]): Record<string, unknown>[];
  run(...params: SqlValue[]): { changes: number };
}

/** The narrow database handle repositories are given. */
export interface Db {
  prepare(sql: string): DbStatement;
  exec(sql: string): void;
  /** Runs `work` in a transaction, rolling back if it throws. */
  transaction<T>(work: () => T): T;
  close(): void;
}

// ---------------------------------------------------------------------------
// Schema versioning
// ---------------------------------------------------------------------------

/**
 * The shape `schema.ts` describes. A fresh database is created straight from
 * that file and stamped with this number; an existing one is brought forward
 * by the steps below. There is no migration chain to replay because the move
 * off Postgres did not carry its history over.
 */
export const SCHEMA_VERSION = 1;

/**
 * Forward-only upgrades for databases that already exist, applied in order for
 * every entry whose `to` exceeds the file's `PRAGMA user_version`. Adding one
 * means bumping `SCHEMA_VERSION` and editing `schema.ts` to match, so that a
 * new database and an upgraded one end up identical.
 */
const MIGRATIONS: ReadonlyArray<{ to: number; sql: string }> = [];

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

export interface OpenDatabaseOptions {
  /** Database file, or ":memory:". Parent directories are created. */
  path: string;
}

/**
 * Opens the database, applies the connection pragmas, and brings the schema up
 * to `SCHEMA_VERSION`.
 *
 * The pragmas are not optional:
 * - `journal_mode = WAL` so a reader (`npm run dump`, an ad-hoc `sqlite3`
 *   query) does not block the running game.
 * - `foreign_keys = ON` because SQLite defaults it OFF per connection, and the
 *   `game_events -> game_sessions` cascade is the only thing keeping events
 *   from outliving their session.
 * - `busy_timeout = 5000` so a concurrent writer waits instead of failing.
 */
export function openDatabase(options: OpenDatabaseOptions): Db {
  if (options.path !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(options.path)), { recursive: true });
  }

  const database = new Database(options.path);

  try {
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");

    migrate(database);
  } catch (error) {
    // Opening failed, so nobody is holding this handle to close it.
    database.close();
    throw error;
  }

  return {
    prepare: (sql) => database.prepare(sql) as unknown as DbStatement,
    exec: (sql) => {
      database.exec(sql);
    },
    transaction: <T>(work: () => T): T => database.transaction(work)(),
    close: () => database.close(),
  };
}

function migrate(database: BetterSqlite3.Database): void {
  const current = Number(database.pragma("user_version", { simple: true }));

  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${current} is newer than this build understands ` +
        `(${SCHEMA_VERSION}). Update the engine or start from a fresh database.`,
    );
  }

  if (current === SCHEMA_VERSION) return;

  database.transaction(() => {
    if (current === 0) {
      database.exec(SCHEMA_SQL);
    } else {
      for (const migration of MIGRATIONS) {
        if (migration.to > current) database.exec(migration.sql);
      }
    }
    // Interpolated, not bound: PRAGMA does not accept parameters. The value is
    // a module constant, never request input.
    database.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
}
