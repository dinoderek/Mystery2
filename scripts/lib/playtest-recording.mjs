/**
 * The playtest bundle: what a game played on `prod` leaves behind, in one dated
 * folder under the config root.
 *
 *   <config root>/playtests/<YYYY-MM-DD>/
 *     ai-calls.jsonl   every model call (`AI_CALL_LOG`), appended
 *     server.log       the server's stdout and stderr, appended
 *     game.db          a snapshot of `prod`, replaced each time the server stops
 *     notes.md         one heading per game, for the parent to write under
 *
 * The launcher (`scripts/dev.mjs`) records whenever it serves `prod`, and
 * nothing else; `./dev sessions bundle` writes the snapshot and notes by hand,
 * for a server that was killed outright. The bundle holds the case's solution
 * and everything a child typed, so it belongs outside the checkout: set
 * `MYSTERY_CONFIG_ROOT`.
 */

import fs from "node:fs";
import path from "node:path";

import { PROD_DATABASE, resolveDatabaseFile } from "../../lib/database-target.mjs";
import { isUsingExternalLocalConfigRoot, resolveLocalConfigRoot } from "../local-config.mjs";
import { snapshotDatabase } from "./database-snapshot.mjs";
import { listSessions } from "./dev-sessions.mjs";

/** The directory under the config root holding one folder per day. */
export const PLAYTESTS_DIRNAME = "playtests";

export const BUNDLE_FILES = {
  aiCalls: "ai-calls.jsonl",
  serverLog: "server.log",
  snapshot: "game.db",
  notes: "notes.md",
};

/** The local calendar date, as the folder names it. @param {Date} [date] @returns {string} */
export function localDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The bundle folder for a day.
 *
 * @param {string} root the checkout
 * @param {Record<string, string | undefined>} env
 * @param {string} date YYYY-MM-DD
 * @returns {string}
 */
export function resolvePlaytestDir(root, env, date) {
  return path.join(resolveLocalConfigRoot(root, env), PLAYTESTS_DIRNAME, date);
}

/**
 * @typedef {object} Recording
 * @property {string} dir the bundle folder
 * @property {string} serverLog where the server's output is appended
 * @property {string} databaseFile the `prod` database to snapshot
 * @property {Record<string, string | undefined>} env the server's environment
 */

/**
 * Whether this run records, and how: only a server on `prod` does. The call
 * log goes into the folder unless `AI_CALL_LOG` is already set, which wins.
 * `FORCE_COLOR` keeps the server's colours on the terminal through the pipe.
 *
 * Pure: nothing is created until `beginRecording`.
 *
 * @param {{ root: string, env: Record<string, string | undefined>, databaseName: string, date: string }} options
 * @returns {Recording | null}
 */
export function planRecording({ root, env, databaseName, date }) {
  if (databaseName !== PROD_DATABASE) return null;
  const dir = resolvePlaytestDir(root, env, date);
  return {
    dir,
    serverLog: path.join(dir, BUNDLE_FILES.serverLog),
    databaseFile: resolveDatabaseFile(PROD_DATABASE, root, env),
    env: {
      ...env,
      AI_CALL_LOG: env.AI_CALL_LOG?.trim() ? env.AI_CALL_LOG : path.join(dir, BUNDLE_FILES.aiCalls),
      FORCE_COLOR: "1",
    },
  };
}

/**
 * Creates the folder for a run `planRecording` said records, and says where it is.
 *
 * @param {Recording} recording
 * @param {{ root: string, env: Record<string, string | undefined>, log?: (line: string) => void }} context
 */
export function beginRecording(recording, { root, env, log = console.log }) {
  fs.mkdirSync(recording.dir, { recursive: true });
  log(`Recording this playtest in ${recording.dir}`);
  if (!isUsingExternalLocalConfigRoot(root, env)) {
    log("  That is inside the checkout: set MYSTERY_CONFIG_ROOT to keep playtests elsewhere (docs/local-infrastructure.md).");
  }
}

/**
 * Snapshots `databaseFile` into the folder as `game.db`, then adds a heading
 * to `notes.md` for each game played on the folder's day not already headed
 * there.
 *
 * @param {{ dir: string, databaseFile: string, log?: (line: string) => void }} options
 * @returns {Promise<{ snapshot: boolean, added: number }>} `snapshot` is false
 *   when there is no database yet (no game was ever started)
 * @throws when the snapshot or the notes cannot be written; the error names the file
 */
export async function writeBundle({ dir, databaseFile, log = console.log }) {
  if (!fs.existsSync(databaseFile)) {
    log(`No database at ${databaseFile} yet, so no snapshot: no game was started.`);
    return { snapshot: false, added: 0 };
  }

  const snapshot = path.join(dir, BUNDLE_FILES.snapshot);
  try {
    fs.mkdirSync(dir, { recursive: true });
    await snapshotDatabase(databaseFile, snapshot);
  } catch (error) {
    throw new Error(`could not snapshot ${databaseFile} to ${snapshot}: ${error.message}`, { cause: error });
  }

  const notes = path.join(dir, BUNDLE_FILES.notes);
  let added;
  try {
    const date = path.basename(dir);
    const played = (await listSessions(snapshot)).filter((row) => playedOn(row, date));
    added = updateNotes(notes, played, date);
  } catch (error) {
    throw new Error(`could not write ${notes}: ${error.message}`, { cause: error });
  }
  log(`Playtest bundle: ${snapshot}, ${added} new ${added === 1 ? "game" : "games"} in ${notes}`);
  return { snapshot: true, added };
}

/**
 * After the server stops: writes the bundle, logging a failure once rather
 * than throwing, so the launcher still exits with the server's status.
 *
 * @param {Recording} recording
 * @param {{ log?: (line: string) => void, err?: (line: string) => void }} [context]
 * @returns {Promise<boolean>} whether the bundle was written
 */
export async function finishRecording(recording, { log = console.log, err = console.error } = {}) {
  try {
    await writeBundle({ dir: recording.dir, databaseFile: recording.databaseFile, log });
    return true;
  } catch (error) {
    err(`Playtest bundle: ${error.message}`);
    return false;
  }
}

/**
 * Runs a server under a recording and writes the bundle once it stops.
 *
 * @param {Recording} recording
 * @param {(env: Record<string, string | undefined>, serverLog: string) => Promise<number>} serve
 *   starts the server with this environment, its output teed to `serverLog`,
 *   and resolves to its exit status
 * @param {{ log?: (line: string) => void, err?: (line: string) => void }} [context]
 * @returns {Promise<number>} the server's exit status, whatever became of the bundle
 */
export async function runRecorded(recording, serve, context) {
  const status = await serve(recording.env, recording.serverLog);
  await finishRecording(recording, context);
  return status;
}

/**
 * Whether a game was played on a local day: its span, from its start to its
 * last event, touches that day. A game resumed days later counts on both.
 *
 * @param {import("./dev-sessions.mjs").SessionRow} row
 * @param {string} date YYYY-MM-DD, local
 * @returns {boolean}
 */
export function playedOn(row, date) {
  const [year, month, day] = date.split("-").map(Number);
  const dayStart = new Date(year, month - 1, day).getTime();
  const dayEnd = new Date(year, month - 1, day + 1).getTime();
  const start = Date.parse(row.started_at);
  const end = start + (row.duration_seconds ?? 0) * 1000;
  return start < dayEnd && end >= dayStart;
}

/** The session id a notes heading names: its first word. */
const HEADING = /^## (\S+)/;

/**
 * The heading for one game: id, profile, case and outcome.
 *
 * @param {import("./dev-sessions.mjs").SessionRow} row
 * @returns {string}
 */
export function notesHeading(row) {
  const caseName = row.case_title ? `${row.case_title} (${row.blueprint_id})` : row.blueprint_id;
  return `## ${row.session_id} · ${row.profile} · ${caseName} · ${row.outcome ?? "unfinished"}`;
}

/**
 * Appends a heading for each game not already headed in the file, oldest
 * first, and leaves everything already there as it was. A new file starts
 * with a title and a prompt.
 *
 * @param {string} file `notes.md`
 * @param {import("./dev-sessions.mjs").SessionRow[]} rows
 * @param {string} date the day the folder is for
 * @returns {number} how many headings were added
 */
export function updateNotes(file, rows, date) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const headed = new Set(
    (existing ?? "")
      .split("\n")
      .map((line) => HEADING.exec(line)?.[1])
      .filter(Boolean),
  );

  const fresh = [...rows]
    .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at) || a.session_id.localeCompare(b.session_id))
    .filter((row) => !headed.has(row.session_id));

  const preamble =
    existing === null
      ? `# Playtest ${date}\n\nUnder each game, what the game cannot see: hesitation, a parent's help, dictation slips.\n`
      : "";
  if (fresh.length === 0 && existing !== null) return 0;

  const separator = existing === null || existing.endsWith("\n") ? "" : "\n";
  const sections = fresh.map((row) => `\n${notesHeading(row)}\n`).join("");
  fs.writeFileSync(file, `${existing ?? ""}${separator}${preamble}${sections}`);
  return fresh.length;
}

export const BUNDLE_USAGE = `Usage: ./dev sessions bundle [<date>]

  Snapshots the prod database into <config root>/playtests/<date>/game.db and
  adds a notes.md heading for each new game, as the launcher does when a prod
  server stops. For a server that was killed outright. <date> is YYYY-MM-DD,
  today (local) when omitted.
`;

/**
 * Runs `./dev sessions bundle` and returns its exit status.
 *
 * @param {string[]} args arguments after `bundle`
 * @param {{ root: string, out: (text: string) => void, err: (text: string) => void, env: Record<string, string | undefined>, now?: Date }} context
 * @returns {Promise<number>}
 */
export async function runBundle(args, { root, out, err, env, now = new Date() }) {
  if (args.length > 1 || (args.length === 1 && !isCalendarDate(args[0]))) {
    err(`dev: sessions bundle takes one optional date, as YYYY-MM-DD\n\n${BUNDLE_USAGE}`);
    return 2;
  }
  const dir = resolvePlaytestDir(root, env, args[0] ?? localDate(now));
  const databaseFile = resolveDatabaseFile(PROD_DATABASE, root, env);
  try {
    const { snapshot } = await writeBundle({ dir, databaseFile, log: out });
    return snapshot ? 0 : 1;
  } catch (error) {
    err(`dev: ${error.message}`);
    return 1;
  }
}

/** @param {string} text @returns {boolean} */
function isCalendarDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const instant = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(instant.getTime()) && instant.toISOString().startsWith(text);
}
