/**
 * What `./dev run` and `./dev doctor` know about the AIs in `ai.json`. Both read
 * the file through the engine's own loader and resolver, so they cannot accept
 * a file, a name or a key the server would refuse.
 *
 * It needs the installed dependencies (the schema is zod), so `./dev doctor`
 * loads it only after it has installed them.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";

import {
  AIConfigError,
  RUN_OVERRIDE_ENV,
  findOpenRouterKey,
  loadAIConfig,
} from "../../packages/game-engine/src/ai-config.ts";
import { isValidDatabaseName } from "../../lib/database-target.mjs";
import { getAIConfigPath } from "../local-config.mjs";

/** A run refused before anything starts: bad arguments, or an AI that cannot narrate. */
export class RunError extends Error {
  constructor(message) {
    super(message);
    this.name = "RunError";
  }
}

export const RUN_USAGE = "Usage: ./dev run [--lan] [--ai <name>] [--db <name>]";

/**
 * Whether the claude CLI runs: `CLAUDE_CLI_PATH`, else `claude` on the PATH.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: boolean, cli: string }}
 */
export function claudeCliRuns(env) {
  const cli = env.CLAUDE_CLI_PATH?.trim() || "claude";
  return { ok: spawnSync(cli, ["--version"], { stdio: "ignore" }).status === 0, cli };
}

/**
 * `./dev run`'s arguments.
 *
 * @param {string[]} argv
 * @returns {{ ai: string | null, database: string | null, lan: boolean }}
 * @throws RunError with the usage for anything else, including the old
 * `free|paid|claude` positional
 */
export function parseRunArgs(argv) {
  const args = { ai: null, database: null, lan: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];
    if (token === "--lan") {
      args.lan = true;
    } else if (token === "--db") {
      if (!isValidDatabaseName(value ?? "")) throw new RunError(`--db needs a database name (received: "${value ?? ""}")\n${RUN_USAGE}`);
      args.database = value;
      index += 1;
    } else if (token === "--ai") {
      if (!value?.trim() || value.startsWith("--")) throw new RunError(`--ai needs the name of an AI in ai.json, or mock\n${RUN_USAGE}`);
      args.ai = value.trim();
      index += 1;
    } else {
      throw new RunError(`Unexpected argument "${token}"\n${RUN_USAGE}`);
    }
  }
  return args;
}

/**
 * Checks the AI a run asks for, the way the server will at start, and returns
 * the run override the server is to be given, or null.
 *
 * `--ai` wins over an `AI_PROFILE` already in the environment. A claude CLI AI
 * also needs the executable to run.
 *
 * @param {{ root: string, env: Record<string, string | undefined>, ai: string | null, claudeRuns?: typeof claudeCliRuns }} options
 * @returns {{ name: string, provider: string, model: string } | null}
 * @throws RunError naming the AI and what is wrong
 */
export function checkRunAI({ root, env, ai, claudeRuns = claudeCliRuns }) {
  const name = ai ?? (env[RUN_OVERRIDE_ENV]?.trim() || null);
  let loaded;
  try {
    loaded = loadAIConfig({ repoRoot: root, env: { ...env, [RUN_OVERRIDE_ENV]: name ?? "" } });
  } catch (error) {
    if (error instanceof AIConfigError) throw new RunError(error.message);
    throw error;
  }
  const override = loaded.runOverride;
  if (!override) return null;

  if (override.profile.provider === "claude-cli") {
    const { ok, cli } = claudeRuns(env);
    if (!ok) {
      throw new RunError(`AI "${override.name}" narrates through "${cli}", which did not run. Install Claude Code and log in, or set CLAUDE_CLI_PATH.`);
    }
  }
  return { name: override.name, provider: override.profile.provider, model: override.profile.model };
}

/**
 * `./dev doctor`'s lines about `ai.json`: whether it parses, and for each AI
 * whether it has what it needs. Never prints a key.
 *
 * A malformed file fails. An AI missing its key or its executable is a warning,
 * since a config root shared between machines may name AIs meant for another.
 *
 * @param {{ root: string, env: Record<string, string | undefined>, claudeRuns?: typeof claudeCliRuns }} options
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function describeAIs({ root, env, claudeRuns = claudeCliRuns }) {
  const file = getAIConfigPath(root, env);
  let loaded;
  try {
    // The run override is the run's business, not the host's.
    loaded = loadAIConfig({ repoRoot: root, env: { ...env, [RUN_OVERRIDE_ENV]: "" } });
  } catch (error) {
    if (error instanceof AIConfigError) return { ok: false, lines: [`FAIL ${error.message}`] };
    throw error;
  }
  if (!fs.existsSync(file)) return { ok: true, lines: [`ok   no ${file}: mock is the only AI`] };

  const lines = [`ok   ${file} parses: mock and ${Object.keys(loaded.config.ais).length} AI(s)`];
  for (const [name, entry] of Object.entries(loaded.config.ais)) {
    const what = `AI "${name}": ${entry.backend} ${entry.model}`;
    if (entry.backend === "openrouter") {
      const found = findOpenRouterKey(entry, loaded.sources);
      lines.push(found ? `ok   ${what}, key from ${found.source}` : `warn ${what}, no key in ai.json, OPENROUTER_API_KEY or .env.local`);
    } else {
      const { ok, cli } = claudeRuns(env);
      lines.push(ok ? `ok   ${what}, "${cli}" runs` : `warn ${what}, "${cli}" did not run: install Claude Code or set CLAUDE_CLI_PATH`);
    }
  }
  return { ok: true, lines };
}
