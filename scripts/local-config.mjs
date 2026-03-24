import path from "node:path";

export const MYSTERY_CONFIG_ROOT_ENV = "MYSTERY_CONFIG_ROOT";

function normalizeRoot(rootDir) {
  return path.resolve(rootDir);
}

function readConfiguredRoot(env) {
  const rawValue = env?.[MYSTERY_CONFIG_ROOT_ENV];
  if (typeof rawValue !== "string") return null;

  const trimmed = rawValue.trim();
  return trimmed.length > 0 ? trimmed : null;
}

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

export function isUsingExternalLocalConfigRoot(
  repoRoot = process.cwd(),
  env = process.env,
) {
  return resolveLocalConfigRoot(repoRoot, env) !== normalizeRoot(repoRoot);
}

export function resolveLocalConfigPath(
  relativePath,
  repoRoot = process.cwd(),
  env = process.env,
) {
  return path.join(resolveLocalConfigRoot(repoRoot, env), relativePath);
}

export function getBaseEnvPath(
  repoRoot = process.cwd(),
  env = process.env,
) {
  return resolveLocalConfigPath(".env.local", repoRoot, env);
}

export function getAIEnvPath(
  repoRoot = process.cwd(),
  mode,
  env = process.env,
) {
  return resolveLocalConfigPath(`.env.ai.${mode}.local`, repoRoot, env);
}

export function getImagesEnvPath(
  repoRoot = process.cwd(),
  env = process.env,
) {
  return resolveLocalConfigPath(".env.images.local", repoRoot, env);
}

export function getDeployEnvPath(
  repoRoot = process.cwd(),
  envName,
  env = process.env,
) {
  return resolveLocalConfigPath(`.env.deploy.${envName}.local`, repoRoot, env);
}

export function getAuthUsersLocalPath(
  repoRoot = process.cwd(),
  env = process.env,
) {
  return resolveLocalConfigPath("supabase/seed/auth-users.local.json", repoRoot, env);
}

export function getAuthUsersExamplePath(repoRoot = process.cwd()) {
  return path.join(normalizeRoot(repoRoot), "supabase/seed/auth-users.example.json");
}

export function getBootstrapUsersPath(
  repoRoot = process.cwd(),
  envName,
  env = process.env,
) {
  return resolveLocalConfigPath(`deploy/bootstrap-users.${envName}.local.json`, repoRoot, env);
}

export function getBlueprintsDir(
  repoRoot = process.cwd(),
  env = process.env,
) {
  return resolveLocalConfigPath("blueprints", repoRoot, env);
}

export function getBriefsDir(
  repoRoot = process.cwd(),
  env = process.env,
) {
  return resolveLocalConfigPath("briefs", repoRoot, env);
}

export function getBlueprintImagesDir(
  repoRoot = process.cwd(),
  env = process.env,
) {
  return resolveLocalConfigPath("blueprint-images", repoRoot, env);
}

export function getBootstrapUsersExamplePath(repoRoot = process.cwd(), envName) {
  return path.join(
    normalizeRoot(repoRoot),
    `deploy/bootstrap-users.${envName}.example.json`,
  );
}

export function formatResolvedLocalConfigPath(
  repoRoot = process.cwd(),
  filePath,
) {
  const normalizedRepoRoot = normalizeRoot(repoRoot);
  const normalizedFilePath = path.resolve(filePath);
  const relativePath = path.relative(normalizedRepoRoot, normalizedFilePath);

  if (
    relativePath.length > 0 &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  ) {
    return relativePath;
  }

  if (relativePath === "") {
    return ".";
  }

  return normalizedFilePath;
}
