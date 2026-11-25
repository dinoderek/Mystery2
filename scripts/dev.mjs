/**
 * Starts the game: one Node process, serving the app and its API.
 *
 * `npm run dev`                 narrates with the AI chosen on the settings page,
 *                               mock if none
 * `npm run dev -- --ai <name>`  narrates with an AI from `ai.json` (or mock) for
 *                               this run, which the server receives as
 *                               `AI_PROFILE`; `./dev run --ai <name>` is the same
 *
 * The AI is checked here, as the server checks it at start, so a malformed
 * `ai.json`, a name it does not have, an OpenRouter AI without a key or a claude
 * CLI AI without the executable stops the run before anything starts.
 *
 * `--db <name>` picks the database. Without it this checkout gets its own,
 * named after the worktree; `npm run prod` passes `--db prod`, the persistent
 * one. The AI and the database are orthogonal.
 *
 * `--lan` serves a build to other devices, for a playtest, on the `prod`
 * database unless `--db` names another (`scripts/lib/lan-server.mjs`).
 */

import path from "node:path";

import { readEnvFile } from "../packages/game-engine/src/env-file.ts";
import { getBaseEnvPath } from "./local-config.mjs";
import { checkRunAI, parseRunArgs } from "./lib/dev-ai.mjs";
import { npmBin, runCommand } from "./lib/process.mjs";
import { runLanServer } from "./lib/lan-server.mjs";
import { resolveWorktreePorts } from "../lib/worktree-ports.mjs";
import {
  DATABASE_NAME_ENV,
  resolveDatabaseFile,
  resolveDatabaseName,
} from "../lib/database-target.mjs";

const rootDir = process.cwd();

let args;
let override;
try {
  args = parseRunArgs(process.argv.slice(2));
  override = checkRunAI({ root: rootDir, env: process.env, ai: args.ai });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const env = { ...readEnvFile(getBaseEnvPath(rootDir, process.env)), ...process.env };

// The server runs from web/, so a relative log path would land there.
if (env.AI_CALL_LOG?.trim()) env.AI_CALL_LOG = path.resolve(env.AI_CALL_LOG.trim());

// The flag just typed has to outrank an ambient MYSTERY_DATABASE, or an
// exported one would silently win.
if (args.database) env[DATABASE_NAME_ENV] = args.database;
else if (args.lan) env[DATABASE_NAME_ENV] = "prod";

if (override) {
  env.AI_PROFILE = override.name;
  console.log(`Starting the game with AI "${override.name}" (${override.provider} ${override.model})...`);
} else {
  // Only the environment carries a run override, never .env.local.
  delete env.AI_PROFILE;
  console.log("Starting the game with the AI chosen on the settings page (mock if none)...");
}

const databaseName = resolveDatabaseName(rootDir, env);
console.log(`Database: ${databaseName} (${resolveDatabaseFile(databaseName, rootDir, env)})`);

if (args.lan) process.exit(await runLanServer({ root: rootDir, env }));

const { ports } = resolveWorktreePorts(rootDir);
runCommand(npmBin, ["-w", "web", "run", "dev", "--", "--port", String(ports.web)], env);
