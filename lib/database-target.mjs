/* global process */

/**
 * Which database this checkout talks to.
 *
 * A worktree gets its own, for the same reason it gets its own port: two
 * checkouts must not collide. Sharing one file across worktrees is not merely
 * untidy — `MIGRATIONS` in the engine is forward-only and keyed on
 * `PRAGMA user_version`, so a branch that bumps `SCHEMA_VERSION` upgrades the
 * shared file and every other checkout then refuses to open it.
 *
 *   npm run dev    <config root>/database/<worktree name>/game.db
 *   npm run dev    <config root>/database/main/game.db        (main checkout)
 *   npm run prod   <config root>/database/prod/game.db
 *
 * Blueprints and images stay shared: they are content, they are expensive to
 * generate, and nothing about them is branch-specific. Only the database — the
 * one thing carrying a schema version — is split.
 *
 * The name is derived here rather than passed down from the launcher, so a
 * server, an eval harness, and an ad-hoc script started in the same worktree
 * all land on the same file without having to agree on an argument.
 *
 * @typedef {Record<string, string | undefined>} Env
 */

import fs from "node:fs";
import path from "node:path";

import { resolveLocalConfigRoot } from "../scripts/local-config.mjs";
import { detectWorktreeName } from "./worktree-ports.mjs";

/** Env var naming the database, overriding the worktree-derived default. */
export const DATABASE_NAME_ENV = "MYSTERY_DATABASE";

/** The persistent database: real play history, never a test or a branch. */
export const PROD_DATABASE = "prod";

/** What the main checkout uses when nothing overrides it. */
export const MAIN_DATABASE = "main";

/**
 * What a test run uses. Pinned rather than derived: the suite's server and the
 * testkit that reads its database have to agree on the file, and a fixed name
 * is one fewer thing that can drift between them. It is only ever created
 * inside the run's temporary config root.
 */
export const TEST_DATABASE = "test";

/** The single file inside a database directory. */
export const DATABASE_FILENAME = "game.db";

/** Directory holding every database, one subdirectory each. */
const DATABASES_DIRNAME = "database";

/**
 * SQLite spreads one database over three files. Reset and copy have to account
 * for all of them, which is the argument for a directory per database.
 */
export const DATABASE_SIDECAR_SUFFIXES = ["-wal", "-shm"];

/**
 * A database name is one path segment. Rejecting the rest keeps
 * `MYSTERY_DATABASE` from reaching outside the databases directory.
 *
 * @param {string} name @returns {boolean}
 */
export function isValidDatabaseName(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("\0")
  );
}

/** @param {string} name @param {string} source @returns {string} */
function assertValidDatabaseName(name, source) {
  if (!isValidDatabaseName(name)) {
    throw new Error(
      `Invalid database name from ${source}: ${JSON.stringify(name)}. ` +
        "A database name is a single path segment.",
    );
  }
  return name;
}

/**
 * The database this checkout resolves to: `MYSTERY_DATABASE` when set, else the
 * worktree's name, else `main`.
 *
 * @param {string} [repoRoot] @param {Env} [env] @returns {string}
 */
export function resolveDatabaseName(repoRoot = process.cwd(), env = process.env) {
  const configured = env?.[DATABASE_NAME_ENV]?.trim();
  if (configured) return assertValidDatabaseName(configured, DATABASE_NAME_ENV);

  const worktreeName = detectWorktreeName(repoRoot);
  if (!worktreeName) return MAIN_DATABASE;

  return assertValidDatabaseName(worktreeName, "the worktree name");
}

/**
 * Directory the databases live under — in the config root when one is set, so
 * they survive a checkout being deleted.
 *
 * @param {string} [repoRoot] @param {Env} [env] @returns {string}
 */
export function resolveDatabasesRoot(repoRoot = process.cwd(), env = process.env) {
  return path.join(resolveLocalConfigRoot(repoRoot, env), DATABASES_DIRNAME);
}

/** @param {string} name @param {string} [repoRoot] @param {Env} [env] @returns {string} */
export function resolveDatabaseDir(name, repoRoot = process.cwd(), env = process.env) {
  assertValidDatabaseName(name, "the caller");
  return path.join(resolveDatabasesRoot(repoRoot, env), name);
}

/**
 * The database file for a name, sidecars alongside it.
 *
 * @param {string} name @param {string} [repoRoot] @param {Env} [env]
 * @returns {string}
 */
export function resolveDatabaseFile(name, repoRoot = process.cwd(), env = process.env) {
  return path.join(resolveDatabaseDir(name, repoRoot, env), DATABASE_FILENAME);
}

/**
 * Every database that exists on disk, sorted. A directory without a `game.db`
 * is reported too: that is an initialised-but-never-opened database, and
 * hiding it would make `db:init` look like it did nothing.
 *
 * @param {string} [repoRoot] @param {Env} [env]
 * @returns {Array<{ name: string, dir: string, file: string, exists: boolean }>}
 */
export function listDatabases(repoRoot = process.cwd(), env = process.env) {
  const root = resolveDatabasesRoot(repoRoot, env);

  /** @type {fs.Dirent[]} */
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    // No databases directory yet is an empty list, not a failure.
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isDirectory() && isValidDatabaseName(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const dir = path.join(root, name);
      const file = path.join(dir, DATABASE_FILENAME);
      return { name, dir, file, exists: fs.existsSync(file) };
    });
}
