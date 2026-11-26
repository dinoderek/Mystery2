/**
 * `./dev sessions`: the games in a database, one row each. Plain Node, no
 * server, and read-only: the file is opened as it is, never migrated or
 * written (a game that is being played does not notice).
 *
 * `listSessions` is the part other tools call; its row shape is the `--json`
 * shape.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import {
  isValidDatabaseName,
  resolveDatabaseFile,
  resolveDatabaseName,
} from "../../lib/database-target.mjs";

export const SESSIONS_USAGE = `Usage: ./dev sessions [--since <date>] [--profile <name>] [--database <name or file>] [--json]

  --since <date>          only games started on or after YYYY-MM-DD (UTC), or a full timestamp
  --profile <name>        only that profile's games
  --database <name|file>  a database name (as --db) or the path of a game.db file;
                          default: this checkout's database
  --json                  print the rows as JSON
`;

/** A usage mistake: reported with the usage text, exit status 2. */
export class SessionsUsageError extends Error {}

/** A database that cannot be listed: exit status 1. */
export class SessionsError extends Error {}

/**
 * @typedef {object} SessionRow
 * @property {string} session_id
 * @property {string} profile profile name
 * @property {string} blueprint_id
 * @property {string | null} case_title the title in the game's saved case
 * @property {number | null} reading_age
 * @property {number} turns events other than `no_turn_line`
 * @property {string | null} outcome null while the game is unfinished
 * @property {string} started_at ISO timestamp
 * @property {number | null} duration_seconds first event to last, null with no events
 */

/** @param {string[]} args @returns {{ since: string | null, profile: string | null, database: string | null, json: boolean }} */
export function parseSessionsArgs(args) {
  const parsed = { since: null, profile: null, database: null, json: false };
  const valueFlags = { "--since": "since", "--profile": "profile", "--database": "database" };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--json") {
      parsed.json = true;
    } else if (Object.hasOwn(valueFlags, token)) {
      const value = args[index + 1];
      if (value === undefined || !value.trim() || value.startsWith("--")) {
        throw new SessionsUsageError(`${token} needs a value`);
      }
      parsed[valueFlags[token]] = value.trim();
      index += 1;
      if (token === "--since") {
        try {
          parseSince(parsed.since);
        } catch (error) {
          throw new SessionsUsageError(error.message);
        }
      }
    } else {
      throw new SessionsUsageError(`Unexpected argument "${token}"`);
    }
  }
  return parsed;
}

/**
 * The database file `--database` (or its absence) names. A value with a path
 * separator, or ending in `.db`, is a file; anything else is a database name.
 *
 * @param {string | null} value
 * @param {{ root: string, env: Record<string, string | undefined> }} context
 * @returns {string}
 */
export function resolveSessionsDatabase(value, { root, env }) {
  if (value === null) return resolveDatabaseFile(resolveDatabaseName(root, env), root, env);
  if (/[\\/]/.test(value) || value.endsWith(".db")) return path.resolve(value);
  if (!isValidDatabaseName(value)) throw new SessionsUsageError(`Invalid database name: ${JSON.stringify(value)}`);
  return resolveDatabaseFile(value, root, env);
}

/** `--since` as an instant: a date is midnight UTC. @param {string} text @returns {number} */
function parseSince(text) {
  const instant = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text);
  if (Number.isNaN(instant)) {
    throw new SessionsError(`--since needs a date as YYYY-MM-DD or a full timestamp, not ${JSON.stringify(text)}`);
  }
  return instant;
}

/**
 * The games in the database file, newest first.
 *
 * @param {string} file path of a `game.db`
 * @param {{ since?: string | null, profile?: string | null }} [filters]
 * @returns {Promise<SessionRow[]>}
 * @throws SessionsError when the file does not exist or cannot be read
 */
export async function listSessions(file, { since = null, profile = null } = {}) {
  const sinceInstant = since === null ? null : parseSince(since);
  if (!fs.existsSync(file)) throw new SessionsError(`no database file at ${file}`);

  // Loaded here so `./dev doctor` works before dependencies are installed.
  const { openDatabase } = await import("../../packages/game-engine/src/db/client.ts");
  const { SUMMARY_COLUMNS } = await import("../../packages/game-engine/src/db/sessions.ts");

  let db;
  try {
    db = fs.existsSync(`${file}-wal`) || fs.existsSync(`${file}-shm`) ? openDatabase({ path: file, readonly: true }) : openSnapshot(file);
    return readSessions(db, SUMMARY_COLUMNS, { sinceInstant, profile });
  } catch (error) {
    throw new SessionsError(`could not read ${file}: ${error.message}`);
  } finally {
    db?.close();
  }
}

/**
 * A database nobody is writing (no `-wal` or `-shm` beside it), read from a
 * copy in memory. A read-only connection to a WAL file would create those two
 * files and cannot remove them, and fails in a read-only folder; this touches
 * nothing. The copy's header says rollback journal, since an in-memory
 * database has no WAL. A game that starts while the file is being copied can
 * tear the copy: the listing then fails naming the file, or is momentarily
 * inconsistent, which a diagnostic listing accepts. The copy is held in memory,
 * about twice the file's size.
 *
 * @param {string} file
 */
function openSnapshot(file) {
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const bytes = fs.readFileSync(file);
  if (bytes[18] === 2) bytes[18] = 1;
  if (bytes[19] === 2) bytes[19] = 1;
  return new Database(bytes);
}

/**
 * @param {{ prepare: (sql: string) => { all: () => any[], get: () => any } }} db
 * @param {string} summaryColumns
 * @param {{ sinceInstant: number | null, profile: string | null }} filters
 * @returns {SessionRow[]}
 */
function readSessions(db, summaryColumns, { sinceInstant, profile }) {
  const tables = new Set(db.prepare("select name from sqlite_master where type = 'table'").all().map((row) => row.name));
  if (!tables.has("game_sessions") || !tables.has("players")) return [];

  // A database from before reading ages has no column to read.
  const hasReadingAge = db.prepare("select 1 from pragma_table_info('game_sessions') where name = 'reading_age'").get();
  const firstOrLast = (order) => `(select created_at from game_events e where e.session_id = s.id order by sequence ${order} limit 1)`;

  const rows = db
    .prepare(
      `select s.*, p.name as profile_name,
              (select count(*) from game_events e where e.session_id = s.id and e.event_type <> 'no_turn_line') as turns,
              ${firstOrLast("asc")} as first_event_at,
              ${firstOrLast("desc")} as last_event_at
         from (select ${summaryColumns}, player_id${hasReadingAge ? ", reading_age" : ""} from game_sessions) s
         join players p on p.id = s.player_id`,
    )
    .all();

  return rows
    .filter((row) => (profile === null || row.profile_name === profile) && (sinceInstant === null || Date.parse(row.created_at) >= sinceInstant))
    .map((row) => ({
      session_id: row.id,
      profile: row.profile_name,
      blueprint_id: row.blueprint_id,
      case_title: row.clue_graph_title ?? null,
      reading_age: row.reading_age ?? null,
      turns: Number(row.turns),
      outcome: row.outcome ?? null,
      started_at: row.created_at,
      duration_seconds: row.first_event_at === null ? null : Math.max(0, Math.round((Date.parse(row.last_event_at) - Date.parse(row.first_event_at)) / 1000)),
    }))
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at) || a.session_id.localeCompare(b.session_id));
}

/** @param {number | null} seconds @returns {string} */
function formatDuration(seconds) {
  if (seconds === null) return "-";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(rest).padStart(2, "0")}s`;
  return `${rest}s`;
}

/** UTC, to the minute. @param {string} iso @returns {string} */
function formatStart(iso) {
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? iso : instant.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * The rows as an aligned table.
 *
 * @param {SessionRow[]} rows
 * @returns {string}
 */
export function formatSessionsTable(rows) {
  if (rows.length === 0) return "No games.";
  const header = ["SESSION", "PROFILE", "CASE", "AGE", "TURNS", "OUTCOME", "STARTED (UTC)", "DURATION"];
  const body = rows.map((row) => [
    row.session_id,
    row.profile,
    row.case_title ? `${row.blueprint_id} ${row.case_title}` : row.blueprint_id,
    row.reading_age === null ? "-" : String(row.reading_age),
    String(row.turns),
    row.outcome ?? "-",
    formatStart(row.started_at),
    formatDuration(row.duration_seconds),
  ]);
  const widths = header.map((title, column) => Math.max(title.length, ...body.map((line) => line[column].length)));
  return [header, ...body].map((line) => line.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd()).join("\n");
}

/**
 * Runs `./dev sessions` and returns its exit status.
 *
 * @param {string[]} args arguments after `sessions`
 * @param {{ root: string, out: (text: string) => void, err: (text: string) => void, env: Record<string, string | undefined> }} context
 * @returns {Promise<number>}
 */
export async function runSessions(args, { root, out, err, env }) {
  try {
    const parsed = parseSessionsArgs(args);
    const file = resolveSessionsDatabase(parsed.database, { root, env });
    const rows = await listSessions(file, parsed);
    out(parsed.json ? JSON.stringify(rows, null, 2) : formatSessionsTable(rows));
    return 0;
  } catch (error) {
    if (error instanceof SessionsUsageError) {
      err(`dev: ${error.message}\n\n${SESSIONS_USAGE}`);
      return 2;
    }
    if (error instanceof SessionsError) {
      err(`dev: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
