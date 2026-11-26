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
 *
 * A run on `prod`, either way, records a playtest bundle with no flag
 * (`scripts/lib/playtest-recording.mjs`): in `<config root>/playtests/<date>/`,
 * the model-call log (unless `AI_CALL_LOG` is already set) and the server's
 * output, still shown here; when the server stops, Ctrl-C and SIGTERM
 * included, a snapshot of `prod` and a `notes.md` heading per new game. The
 * exit status stays the server's. No other database records anything.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { readEnvFile } from "../packages/game-engine/src/env-file.ts";
import { getBaseEnvPath } from "./local-config.mjs";
import { checkRunAI, parseRunArgs } from "./lib/dev-ai.mjs";
import { npmBin, runCommand, startServer } from "./lib/process.mjs";
import { runLanServer } from "./lib/lan-server.mjs";
import { beginRecording, localDate, planRecording, runRecorded } from "./lib/playtest-recording.mjs";
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

const recording = planRecording({ root: rootDir, env, databaseName, date: localDate() });
const { ports } = resolveWorktreePorts(rootDir);
const viteArgs = ["-w", "web", "run", "dev", "--", "--port", String(ports.web)];

/**
 * Vite's own entry point. A recorded run starts it directly rather than through
 * `npm run dev`: npm ignores a SIGINT sent to it alone, and on SIGTERM it and
 * its shell exit while Vite runs on, holding the port and the output pipe, so
 * the launcher would wait forever and never write the bundle.
 */
function viteEntry(root) {
  const manifest = createRequire(path.join(root, "web", "package.json")).resolve("vite/package.json");
  return path.join(path.dirname(manifest), JSON.parse(fs.readFileSync(manifest, "utf8")).bin.vite);
}

/** @param {Record<string, string | undefined>} serverEnv @param {string | null} serverLog */
const serve = (serverEnv, serverLog = null) =>
  args.lan
    ? runLanServer({ root: rootDir, env: serverEnv, serverLog })
    : startServer({
        command: process.execPath,
        args: [viteEntry(rootDir), "dev", "--port", String(ports.web)],
        cwd: path.join(rootDir, "web"),
        env: serverEnv,
        serverLog,
      }).exit;

if (recording) {
  beginRecording(recording, { root: rootDir, env });
  // Not `process.exit`: that can cut off output still on its way to a pipe.
  process.exitCode = await runRecorded(recording, serve);
} else if (args.lan) {
  process.exit(await serve(env));
} else {
  runCommand(npmBin, viteArgs, env);
}
