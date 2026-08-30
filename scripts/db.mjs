/**
 * The game databases: create one, look at them, throw one away, snapshot one.
 *
 *   npm run db:init  [name]         create it (or bring its schema forward)
 *   npm run db:list                 every database, with what is in it
 *   npm run db:reset [name]         empty it and start again
 *   npm run db:copy  <from> [to]    a consistent snapshot, live game or not
 *
 * `name` defaults to the one this checkout resolves to — the worktree's, or
 * `main`. `prod` is the persistent one `npm run prod` opens, so reset and
 * overwrite both refuse it without `--force`.
 *
 * There is no `migrate` verb: opening a database applies whatever `MIGRATIONS`
 * in the engine has not been applied yet, so `db:init` on an existing database
 * is the migration. It reports the version it moved from.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { SCHEMA_VERSION, openDatabase } from "../packages/game-engine/src/db/client.ts";
import {
  DATABASE_SIDECAR_SUFFIXES,
  PROD_DATABASE,
  isValidDatabaseName,
  listDatabases,
  resolveDatabaseDir,
  resolveDatabaseFile,
  resolveDatabaseName,
} from "../lib/database-target.mjs";

const ROOT_DIR = process.cwd();

const USAGE = `Usage: node scripts/db.mjs <command> [name] [--force]

Commands:
  init  [name]        Create the database, or bring an existing one's schema
                      forward. Safe to re-run.
  list                Every database on disk: schema version, row counts, size.
  reset [name]        Delete the database and recreate it empty.
                      Refuses "${PROD_DATABASE}" without --force.
  copy  <from> [to]   Snapshot <from> onto <to>. Consistent even while the game
                      is writing. Refuses to overwrite without --force.

  Every [name] defaults to this checkout's database (the worktree's, or
  "main"), so seeding it from the persistent one is: db:copy prod
`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Every file SQLite spreads one database over. */
function databaseFiles(file) {
  return [file, ...DATABASE_SIDECAR_SUFFIXES.map((suffix) => `${file}${suffix}`)];
}

function totalSizeBytes(file) {
  return databaseFiles(file).reduce((total, candidate) => {
    try {
      return total + fs.statSync(candidate).size;
    } catch {
      return total;
    }
  }, 0);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Schema version and row counts, read without writing: inspecting a database
 * must never be what upgrades it.
 */
function inspect(file) {
  if (!fs.existsSync(file)) return null;

  const db = openDatabase({ path: file, readonly: true });
  try {
    const version = Number(db.prepare("pragma user_version").get()?.user_version ?? 0);
    if (version === 0) return { version, counts: null };

    const countOf = (table) =>
      Number(db.prepare(`select count(*) as n from ${table}`).get()?.n ?? 0);

    return {
      version,
      counts: {
        players: countOf("players"),
        sessions: countOf("game_sessions"),
        events: countOf("game_events"),
      },
    };
  } finally {
    db.close();
  }
}

function describe(file) {
  const details = inspect(file);
  if (!details) return "not created yet";

  const schema =
    details.version === SCHEMA_VERSION
      ? `schema ${details.version}`
      : `schema ${details.version}, engine is at ${SCHEMA_VERSION}`;

  if (!details.counts) return `${schema}, empty`;

  const { players, sessions, events } = details.counts;
  return `${schema}, ${players} players, ${sessions} sessions, ${events} events, ${formatSize(totalSizeBytes(file))}`;
}

function resolveName(argument) {
  if (argument === undefined) return resolveDatabaseName(ROOT_DIR, process.env);
  if (!isValidDatabaseName(argument)) fail(`Invalid database name: ${JSON.stringify(argument)}`);
  return argument;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function commandInit(name) {
  const file = resolveDatabaseFile(name, ROOT_DIR, process.env);
  const before = inspect(file);

  // `openDatabase` creates the directory, applies the schema to a new file and
  // migrates an existing one. This command is that call, plus an explanation.
  openDatabase({ path: file }).close();

  if (!before) console.log(`Created ${name}: ${file}`);
  else if (before.version < SCHEMA_VERSION) {
    console.log(`Migrated ${name} from schema ${before.version} to ${SCHEMA_VERSION}: ${file}`);
  } else console.log(`${name} is already up to date: ${file}`);

  console.log(`  ${describe(file)}`);
}

function commandList() {
  const databases = listDatabases(ROOT_DIR, process.env);
  const active = resolveDatabaseName(ROOT_DIR, process.env);

  if (databases.length === 0) {
    console.log("No databases yet. Create this checkout's with: npm run db:init");
    return;
  }

  const width = Math.max(...databases.map((entry) => entry.name.length));
  for (const entry of databases) {
    const marker = entry.name === active ? "*" : " ";
    console.log(`${marker} ${entry.name.padEnd(width)}  ${describe(entry.file)}`);
  }

  if (!databases.some((entry) => entry.name === active)) {
    console.log(`\n  "${active}" is this checkout's database and does not exist yet.`);
  } else {
    console.log(`\n  * is this checkout's database.`);
  }
}

function commandReset(name, force) {
  if (name === PROD_DATABASE && !force) {
    fail(
      `Refusing to reset "${PROD_DATABASE}" — it is the persistent database. ` +
        `Re-run with --force if that is really what you want.`,
    );
  }

  const file = resolveDatabaseFile(name, ROOT_DIR, process.env);
  const existed = fs.existsSync(file);

  // The sidecars too: leaving a `-wal` behind would replay committed
  // transactions back into the "empty" database on the next open.
  for (const candidate of databaseFiles(file)) {
    fs.rmSync(candidate, { force: true });
  }

  openDatabase({ path: file }).close();
  console.log(`${existed ? "Reset" : "Created"} ${name}: ${file}`);
}

async function commandCopy(from, to, force) {
  const source = resolveDatabaseFile(from, ROOT_DIR, process.env);
  const destination = resolveDatabaseFile(to, ROOT_DIR, process.env);

  if (!fs.existsSync(source)) fail(`No such database: ${from} (${source})`);
  if (from === to) fail("Source and destination are the same database.");
  if (fs.existsSync(destination) && !force) {
    fail(`${to} already exists (${destination}). Re-run with --force to overwrite it.`);
  }

  // Overwriting leaves the destination's sidecars pointing at bytes that are
  // about to be replaced, so they go first.
  for (const candidate of databaseFiles(destination)) {
    fs.rmSync(candidate, { force: true });
  }
  fs.mkdirSync(resolveDatabaseDir(to, ROOT_DIR, process.env), { recursive: true });

  // Read-only, so a copy can never be what migrates the source.
  const db = openDatabase({ path: source, readonly: true });
  try {
    await db.backup(destination);
  } finally {
    db.close();
  }

  console.log(`Copied ${from} to ${to}: ${destination}`);
  console.log(`  ${describe(destination)}`);
}

// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const positional = argv.filter((argument) => !argument.startsWith("--"));
  const [command, ...rest] = positional;

  const wantsHelp = argv.includes("--help") || argv.includes("-h");
  if (!command || wantsHelp) {
    process.stdout.write(USAGE);
    process.exit(wantsHelp ? 0 : 1);
  }

  switch (command) {
    case "init":
      return commandInit(resolveName(rest[0]));
    case "list":
      return commandList();
    case "reset":
      return commandReset(resolveName(rest[0]), force);
    case "copy": {
      if (rest.length < 1 || rest.length > 2) {
        fail("Usage: node scripts/db.mjs copy <from> [to]");
      }
      // The destination defaults to this checkout's, because seeding a
      // worktree from `prod` is what this command is for — and a worktree's
      // name is generated, not chosen, so it is the last thing to make someone
      // type.
      return commandCopy(resolveName(rest[0]), resolveName(rest[1]), force);
    }
    default:
      process.stdout.write(USAGE);
      return fail(`Unknown command: ${command}`);
  }
}

await main();
