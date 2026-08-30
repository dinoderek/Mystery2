/**
 * Starts the game: one Node process, serving the app and its API.
 *
 * `npm run dev`           mock narration, no network
 * `npm run dev:ai:free`   the model in .env.ai.free.local
 * `npm run dev:ai:paid`   the model in .env.ai.paid.local
 *
 * The mode's env file is loaded into the process rather than seeded into a
 * database, so switching models is switching command — there is no stack to
 * restart and nothing to reseed.
 *
 * `--db <name>` picks the database. Without it this checkout gets its own,
 * named after the worktree; `npm run prod` passes `--db prod`, the persistent
 * one. The AI mode and the database are orthogonal — either can be combined
 * with either.
 */

import { readEnvFile } from "../packages/game-engine/src/env-file.ts";
import { getAIEnvPath, getBaseEnvPath } from "./local-config.mjs";
import { npmBin, runCommand } from "./lib/process.mjs";
import { resolveWorktreePorts } from "../lib/worktree-ports.mjs";
import {
  DATABASE_NAME_ENV,
  isValidDatabaseName,
  resolveDatabaseFile,
  resolveDatabaseName,
} from "../lib/database-target.mjs";

function parseArgs(argv) {
  const args = { mode: null, database: null };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--db") {
      args.database = argv[++index] ?? "";
      if (!isValidDatabaseName(args.database)) {
        console.error(`--db needs a database name (received: "${args.database}")`);
        process.exit(1);
      }
    } else if (token === "free" || token === "paid") {
      args.mode = token;
    } else {
      console.error(`Usage: node scripts/dev.mjs [free|paid] [--db <name>]`);
      process.exit(1);
    }
  }

  return args;
}

const { mode, database } = parseArgs(process.argv.slice(2));

const rootDir = process.cwd();
const baseVars = readEnvFile(getBaseEnvPath(rootDir, process.env));
const modeVars = mode ? readEnvFile(getAIEnvPath(rootDir, mode, process.env)) : {};

if (mode && Object.keys(modeVars).length === 0) {
  console.error(
    `Missing ${getAIEnvPath(rootDir, mode, process.env)} — cannot start in "${mode}" mode.`,
  );
  process.exit(1);
}

const env = { ...baseVars, ...modeVars, ...process.env };

// Same reasoning as the AI keys below: the flag just typed has to outrank an
// ambient MYSTERY_DATABASE, or an exported one would silently win.
if (database) env[DATABASE_NAME_ENV] = database;

if (mode) {
  if (!env.AI_PROVIDER) throw new Error("Missing AI_PROVIDER in env configuration.");
  if (!env.AI_MODEL) throw new Error("Missing AI_MODEL in env configuration.");
  if (env.AI_PROVIDER === "openrouter" && !env.OPENROUTER_API_KEY) {
    throw new Error("Missing OPENROUTER_API_KEY for AI_PROVIDER=openrouter.");
  }
  // The mode file has to win over the ambient environment here, or a stale
  // exported AI_MODEL would silently outrank the file you just pointed at.
  env.AI_PROVIDER = modeVars.AI_PROVIDER ?? env.AI_PROVIDER;
  env.AI_MODEL = modeVars.AI_MODEL ?? env.AI_MODEL;
  env.OPENROUTER_API_KEY = modeVars.OPENROUTER_API_KEY ?? env.OPENROUTER_API_KEY;
  console.log(`Starting the game with the "${mode}" AI profile (${env.AI_MODEL})...`);
} else {
  console.log('Starting the game with mock narration...');
}

const databaseName = resolveDatabaseName(rootDir, env);
console.log(`Database: ${databaseName} (${resolveDatabaseFile(databaseName, rootDir, env)})`);

const { ports } = resolveWorktreePorts(rootDir);
runCommand(npmBin, ["-w", "web", "run", "dev", "--", "--port", String(ports.web)], env);
