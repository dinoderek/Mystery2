/**
 * What a harness that starts a game server of its own gives that server to
 * narrate with.
 *
 * A server reads `ai.json` from its config root once, at start. A harness
 * starts its server on a temporary root, so it writes that root's `ai.json`
 * with exactly the AIs it was asked for and names one on each request. The AIs
 * are read from the config root the harness is pointed at (`MYSTERY_CONFIG_ROOT`,
 * else the repo), with the key an entry lacks taken from `OPENROUTER_API_KEY`
 * or that root's `.env.local`, as the server itself would. Nothing else in
 * the environment names a model.
 *
 * The temporary root, and the key in clear inside it, go when the server stops.
 * Everything here fails before any server starts, naming the AI.
 *
 * It needs the installed dependencies (the schema is zod).
 */

import fs from "node:fs";

import {
  AIConfigError,
  RUN_OVERRIDE_ENV,
  availableAINames,
  findOpenRouterKey,
  loadAIConfig,
  parseAIConfig,
} from "../../packages/game-engine/src/ai-config.ts";
import { getAIConfigPath } from "../local-config.mjs";

/** The names a request can use without an entry: they resolve inside the server. */
const BUILT_IN = new Set(["mock", "default"]);

/**
 * The entries of the named AIs, as a configuration a server can start on, each
 * OpenRouter entry carrying the key it will use.
 *
 * `mock` and `default` need no entry and are skipped.
 *
 * @param {{ repoRoot: string, env: Record<string, string | undefined>, names: string[] }} options
 * @returns {{ ais: Record<string, { backend: string, model: string, key?: string }> }}
 * @throws AIConfigError naming the AI that is missing from `ai.json` or has no key
 */
export function pickAIs({ repoRoot, env, names }) {
  // Nothing is read when no entry is wanted: a run that names only built-ins
  // does not depend on, or open, the config root's files.
  const wanted = [...new Set(names)].filter((name) => !BUILT_IN.has(name));
  if (wanted.length === 0) return { ais: {} };
  // The run override is a server's business, not the harness's.
  const { file, config, sources } = loadAIConfig({ repoRoot, env: { ...env, [RUN_OVERRIDE_ENV]: "" } });
  const ais = {};
  for (const name of wanted) {
    if (!Object.hasOwn(config.ais, name)) {
      throw new AIConfigError(
        `AI "${name}" is not in ${file}. Name one of: ${availableAINames(config).join(", ")}.`,
      );
    }
    const entry = config.ais[name];
    if (entry.backend === "claude-cli") {
      ais[name] = { backend: entry.backend, model: entry.model };
      continue;
    }
    const found = findOpenRouterKey(entry, sources);
    if (!found) {
      throw new AIConfigError(
        `AI "${name}" uses openrouter but has no key: give its entry in ${file} a "key", ` +
          "or set OPENROUTER_API_KEY in the environment or in .env.local.",
      );
    }
    ais[name] = { backend: entry.backend, model: entry.model, key: found.key };
  }
  return { ais };
}

/**
 * Writes `ai.json` into a temporary config root, after checking it against the
 * schema the server will check it with. Owner-only, since it may hold a key.
 *
 * @param {string} configRoot
 * @param {unknown} config
 * @throws AIConfigError when the configuration is not valid
 */
export function writeAIConfig(configRoot, config) {
  const checked = parseAIConfig(config);
  fs.writeFileSync(getAIConfigPath(configRoot, {}), `${JSON.stringify(checked, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Checks the named AIs now, and returns the `seed` for `startTestServer` that
 * writes them into the server's root. Naming only `mock` or `default` writes
 * nothing: mock is the only AI a root without `ai.json` has.
 *
 * @param {{ repoRoot: string, env?: Record<string, string | undefined>, names: string[] }} options
 * @returns {((configRoot: string) => void) | undefined}
 * @throws AIConfigError before any server has started
 */
export function seedAIs({ repoRoot, env = process.env, names }) {
  const config = pickAIs({ repoRoot, env, names });
  if (Object.keys(config.ais).length === 0) return undefined;
  return (configRoot) => writeAIConfig(configRoot, config);
}
