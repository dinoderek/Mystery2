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
 */

import { readEnvFile } from "../packages/game-engine/src/env-file.ts";
import { getAIEnvPath, getBaseEnvPath } from "./local-config.mjs";
import { npmBin, runCommand } from "./lib/process.mjs";
import { resolveWorktreePorts } from "../lib/worktree-ports.mjs";

const mode = process.argv[2] ?? null;
if (mode !== null && mode !== "free" && mode !== "paid") {
  console.error("Usage: node scripts/dev.mjs [free|paid]");
  process.exit(1);
}

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

const { ports } = resolveWorktreePorts(rootDir);
runCommand(npmBin, ["-w", "web", "run", "dev", "--", "--port", String(ports.web)], env);
