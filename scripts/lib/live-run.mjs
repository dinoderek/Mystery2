/**
 * What a live-AI run needs before it starts: the AI it was asked for, checked,
 * and the environment the suite reads it from.
 *
 * Nothing calls a model unless a name is given, and a name is looked up in the
 * `ai.json` of the config root the run is pointed at (`scripts/lib/ai-seed.mjs`).
 * The suites read the name from `AI_LIVE_AI`, which only these plans set.
 *
 * It needs the installed dependencies (the schema is zod).
 */

import { pickAIs, seedAIs } from "./ai-seed.mjs";

/** The variable the live suites read their AI's name from. */
export const LIVE_AI_ENV = "AI_LIVE_AI";
/** The variable the live blueprint suite reads its model from. */
export const LIVE_MODEL_ENV = "AI_LIVE_MODEL";

const DEFAULT_TIMEOUT_MS = "600000";

/** A run refused before anything starts: no name, or an AI that cannot be used. */
export class LiveRunError extends Error {
  constructor(message) {
    super(message);
    this.name = "LiveRunError";
  }
}

export const SERVER_SUITES = {
  integration: "tests/api/integration/live-ai",
  e2e: "tests/api/e2e/live-ai-flow.test.ts",
};

export const LIVE_USAGE = {
  server: "Usage: node scripts/run-live-ai.mjs <integration|e2e> <ai>  (an AI named in ai.json)",
  blueprint: "Usage: node scripts/run-live-blueprint-generation.mjs <ai>  (an openrouter AI named in ai.json)",
};

/**
 * The AI a live run names. There is no default: a model is called only on
 * request.
 *
 * @param {string | undefined} name
 * @param {string} usage
 * @returns {string}
 * @throws LiveRunError with the usage when there is no name, or it is a built-in one
 */
function requireName(name, usage) {
  const trimmed = name?.trim();
  if (!trimmed) throw new LiveRunError(`A live run names the AI it calls.\n${usage}`);
  if (trimmed === "mock" || trimmed === "default") {
    throw new LiveRunError(`"${trimmed}" calls no model. Name an AI from ai.json.\n${usage}`);
  }
  return trimmed;
}

/** The variables every live suite reads. */
function suiteEnv(env, name) {
  return {
    AI_LIVE: "1",
    [LIVE_AI_ENV]: name,
    AI_LIVE_TEST_TIMEOUT_MS: env.AI_LIVE_TEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
  };
}

/** Turns a failure to find or use the named AI into a run error. */
function checked(action) {
  try {
    return action();
  } catch (error) {
    if (error instanceof Error && error.name === "AIConfigError") throw new LiveRunError(error.message);
    throw error;
  }
}

/**
 * The integration or end-to-end run: which tests, the `seed` that writes the one
 * AI into the temporary server's root, and the suite's environment.
 *
 * @param {{ repoRoot: string, env: Record<string, string | undefined>, argv: string[] }} options `argv` is `[suite, ai]`
 * @returns {{ suite: string, name: string, vitestTarget: string, seed: (configRoot: string) => void, suiteEnv: Record<string, string> }}
 * @throws LiveRunError before any server starts
 */
export function planServerRun({ repoRoot, env, argv }) {
  const [suite, ai, ...extra] = argv;
  if (!Object.hasOwn(SERVER_SUITES, suite ?? "") || extra.length > 0) throw new LiveRunError(LIVE_USAGE.server);
  const name = requireName(ai, LIVE_USAGE.server);
  const seed = checked(() => seedAIs({ repoRoot, env, names: [name] }));
  return { suite, name, vitestTarget: SERVER_SUITES[suite], seed, suiteEnv: suiteEnv(env, name) };
}

/**
 * The live blueprint run: the named AI's model and key go to the generator
 * through the suite's environment. It starts no server.
 *
 * @param {{ repoRoot: string, env: Record<string, string | undefined>, argv: string[] }} options `argv` is `[ai]`
 * @returns {{ name: string, suiteEnv: Record<string, string> }}
 * @throws LiveRunError when the AI is missing, has no key, or is not an openrouter one
 */
export function planBlueprintRun({ repoRoot, env, argv }) {
  if (argv.length > 1) throw new LiveRunError(LIVE_USAGE.blueprint);
  const name = requireName(argv[0], LIVE_USAGE.blueprint);
  const entry = checked(() => pickAIs({ repoRoot, env, names: [name] })).ais[name];
  if (entry.backend !== "openrouter") {
    throw new LiveRunError(`AI "${name}" is a ${entry.backend} AI; blueprint generation calls an openrouter one.\n${LIVE_USAGE.blueprint}`);
  }
  return { name, suiteEnv: { ...suiteEnv(env, name), [LIVE_MODEL_ENV]: entry.model, OPENROUTER_API_KEY: entry.key } };
}
