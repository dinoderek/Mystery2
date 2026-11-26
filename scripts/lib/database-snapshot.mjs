/**
 * A consistent copy of a game database, live game or not: SQLite's online
 * backup, never a file copy, which can miss what is still in the `-wal`.
 * `npm run db:copy` and the playtest bundle both take their snapshots here.
 */

import fs from "node:fs";
import path from "node:path";

import { DATABASE_SIDECAR_SUFFIXES } from "../../lib/database-target.mjs";

/** Every file SQLite spreads one database over. @param {string} file @returns {string[]} */
export function databaseFiles(file) {
  return [file, ...DATABASE_SIDECAR_SUFFIXES.map((suffix) => `${file}${suffix}`)];
}

/**
 * Writes a snapshot of `source` to `destination`, replacing whatever was there.
 *
 * @param {string} source an existing database file
 * @param {string} destination
 * @returns {Promise<void>}
 */
export async function snapshotDatabase(source, destination) {
  // Loaded here so the scripts that import this stay loadable before
  // dependencies are installed (`./dev doctor`).
  const { openDatabase } = await import("../../packages/game-engine/src/db/client.ts");

  // Overwriting leaves the destination's sidecars pointing at bytes that are
  // about to be replaced, so they go first.
  for (const candidate of databaseFiles(destination)) fs.rmSync(candidate, { force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  // Read-only, so a snapshot can never be what migrates the source.
  const db = openDatabase({ path: source, readonly: true });
  try {
    await db.backup(destination);
  } finally {
    db.close();
  }
}
