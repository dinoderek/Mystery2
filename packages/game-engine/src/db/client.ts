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
  /**
   * Writes a consistent snapshot to `destinationPath`, safe to call while the
   * game is writing — which a file copy would not be, because the committed
   * state is split between the database and its `-wal`.
   */
  backup(destinationPath: string): Promise<void>;
  close(): void;
}

// ---------------------------------------------------------------------------
// Schema versioning
// ---------------------------------------------------------------------------

/**
 * The shape `schema.ts` describes. A fresh database is created straight from
 * that file and stamped with this number; an existing one is brought forward
 * by the steps below. There is no migration chain to replay because the
 * shape the game needs is described in one place, not accumulated.
 */
export const SCHEMA_VERSION = 1;

/** One forward step: the SQL, and the version the database is at afterwards. */
export interface Migration {
  to: number;
  sql: string;
}

/**
 * Forward-only upgrades for databases that already exist. Adding one means
 * bumping `SCHEMA_VERSION` and editing `schema.ts` to match, so that a new
 * database and an upgraded one end up identical.
 *
 * Every version between a file's `PRAGMA user_version` and `SCHEMA_VERSION`
 * needs an entry here — `planMigrations()` refuses to upgrade across a gap
 * rather than stamping a version nothing produced.
 */
const MIGRATIONS: ReadonlyArray<Migration> = [];

/**
 * The steps that take `current` to `target`, in ascending order.
 *
 * Throws when any version in between has no step, and does so before anything
 * is applied. That check is the whole point: the tempting shape is to filter
 * the list and stamp `target` afterwards, which silently marks an old database
 * as current when a `SCHEMA_VERSION` bump lands without its migration. Nothing
 * catches that later — the next open sees the file claiming to be current and
 * returns early — and no test suite can catch it either, because suites build
 * their databases from scratch and never take this path.
 */
export function planMigrations(
  current: number,
  target: number,
  migrations: ReadonlyArray<Migration>,
): Migration[] {
  const steps: Migration[] = [];

  for (let version = current + 1; version <= target; version += 1) {
    const step = migrations.find((migration) => migration.to === version);
    if (!step) {
      throw new Error(
        `No migration to schema version ${version}. A database at version ` +
          `${current} cannot be brought to ${target}: add an entry to ` +
          "MIGRATIONS in db/client.ts, matching the change made to schema.ts.",
      );
    }
    steps.push(step);
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

export interface OpenDatabaseOptions {
  /** Database file, or ":memory:". Parent directories are created. */
  path: string;
  /**
   * Open without writing: no directory is created, no schema is applied, and
   * no migration runs. Inspecting a database must not silently upgrade it, so
   * anything that only reads — `npm run db:list`, `npm run db:copy` — opens
   * this way. The file has to exist already.
   */
  readonly?: boolean;
}

/**
 * Opens the database, applies the connection pragmas, and brings the schema up
 * to `SCHEMA_VERSION`.
 *
 * The pragmas are not optional:
 * - `journal_mode = WAL` so a reader (`npm run db:copy`, an ad-hoc `sqlite3`
 *   query) does not block the running game.
 * - `foreign_keys = ON` because SQLite defaults it OFF per connection, and the
 *   `game_events -> game_sessions` cascade is the only thing keeping events
 *   from outliving their session.
 * - `busy_timeout = 5000` so a concurrent writer waits instead of failing.
 */
export function openDatabase(options: OpenDatabaseOptions): Db {
  const readonly = options.readonly === true;

  if (!readonly && options.path !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(options.path)), { recursive: true });
  }

  const database = new Database(options.path, { readonly });

  try {
    if (readonly) {
      // `journal_mode` is a write, and the schema is whatever the file already
      // holds — a reader takes it as it finds it.
      database.pragma("busy_timeout = 5000");
    } else {
      database.pragma("journal_mode = WAL");
      database.pragma("foreign_keys = ON");
      database.pragma("busy_timeout = 5000");

      migrate(database);
    }
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
    backup: async (destinationPath: string) => {
      fs.mkdirSync(path.dirname(path.resolve(destinationPath)), {
        recursive: true,
      });
      await database.backup(destinationPath);
    },
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

  // Interpolated rather than bound, here and below: PRAGMA does not accept
  // parameters. Every value is a module constant or a `Migration.to`, never
  // request input.
  if (current === 0) {
    database.transaction(() => {
      database.exec(SCHEMA_SQL);
      database.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
    return;
  }

  // Planned first, so a chain that cannot span the gap fails having touched
  // nothing.
  const steps = planMigrations(current, SCHEMA_VERSION, MIGRATIONS);

  // One transaction for the whole chain: SQLite DDL is transactional, and a
  // half-upgraded database is worse than one that refused to move. The version
  // is stamped per step regardless, so it can only ever be set to a number some
  // step actually reached.
  database.transaction(() => {
    for (const step of steps) {
      database.exec(step.sql);
      database.pragma(`user_version = ${step.to}`);
    }
  })();
}
