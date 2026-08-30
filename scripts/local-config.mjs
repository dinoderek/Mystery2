import path from "node:path";

/**
 * Local-only paths: where this machine keeps its env files, blueprints, images
 * and game database. Typed with JSDoc because both TypeScript workspaces
 * resolve this file directly — the engine (`packages/game-engine/src/paths.ts`)
 * and the web app's `svelte-check`.
 *
 * @typedef {Record<string, string | undefined>} Env
 */

export const MYSTERY_CONFIG_ROOT_ENV = "MYSTERY_CONFIG_ROOT";

/** @param {string} rootDir @returns {string} */
function normalizeRoot(rootDir) {
  return path.resolve(rootDir);
}

/** @param {Env | undefined} env @returns {string | null} */
function readConfiguredRoot(env) {
  const rawValue = env?.[MYSTERY_CONFIG_ROOT_ENV];
  if (typeof rawValue !== "string") return null;

  const trimmed = rawValue.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** @param {string} [repoRoot] @param {Env} [env] @returns {string} */
export function resolveLocalConfigRoot(
  repoRoot = process.cwd(),
  env = process.env,
) {
  const normalizedRepoRoot = normalizeRoot(repoRoot);
  const configuredRoot = readConfiguredRoot(env);

  if (!configuredRoot) {
    return normalizedRepoRoot;
  }

  if (!path.isAbsolute(configuredRoot)) {
    throw new Error(
      `${MYSTERY_CONFIG_ROOT_ENV} must be an absolute path (received: "${configuredRoot}")`,
    );
  }

  return path.normalize(configuredRoot);
}

/** @param {string} [repoRoot] @param {Env} [env] @returns {boolean} */
export function isUsingExternalLocalConfigRoot(
  repoRoot = process.cwd(),
  env = process.env,
) {
  return resolveLocalConfigRoot(repoRoot, env) !== normalizeRoot(repoRoot);
}

/** @param {string} relativePath @param {string} [repoRoot] @param {Env} [env] @returns {string} */
function resolveLocalConfigPath(
  relativePath,
  repoRoot = process.cwd(),
  env = process.env,
) {
  return path.join(resolveLocalConfigRoot(repoRoot, env), relativePath);
}

/** @param {string} [repoRoot] @param {Env} [env] @returns {string} */
export function getBaseEnvPath(
  repoRoot = process.cwd(),
  env = process.env,
) {
  return resolveLocalConfigPath(".env.local", repoRoot, env);
}

/** @param {string} repoRoot @param {string} mode @param {Env} [env] @returns {string} */
export function getAIEnvPath(
  repoRoot = process.cwd(),
  mode,
  env = process.env,
) {
  return resolveLocalConfigPath(`.env.ai.${mode}.local`, repoRoot, env);
}

/** @param {string} [repoRoot] @param {Env} [env] @returns {string} */
export function getImagesEnvPath(
  repoRoot = process.cwd(),
  env = process.env,
) {
  return resolveLocalConfigPath(".env.images.local", repoRoot, env);
}

/** @param {string} [repoRoot] @param {Env} [env] @returns {string} */
export function getBlueprintsDir(
  repoRoot = process.cwd(),
  env = process.env,
) {
  return resolveLocalConfigPath("blueprints", repoRoot, env);
}

/** @param {string} [repoRoot] @param {Env} [env] @returns {string} */
export function getBriefsDir(
  repoRoot = process.cwd(),
  env = process.env,
) {
  return resolveLocalConfigPath("briefs", repoRoot, env);
}

/** @param {string} [repoRoot] @param {Env} [env] @returns {string} */
export function getBlueprintImagesDir(
  repoRoot = process.cwd(),
  env = process.env,
) {
  return resolveLocalConfigPath("blueprint-images", repoRoot, env);
}

/** @param {string} [repoRoot] @param {Env} [env] @returns {string} */
export function getChatGenPromptsDir(
  repoRoot = process.cwd(),
  env = process.env,
) {
  return resolveLocalConfigPath("chat-gen-prompts", repoRoot, env);
}

