import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  formatResolvedLocalConfigPath,
  getAuthUsersExamplePath,
  getAuthUsersLocalPath,
  getBaseEnvPath,
} from "./local-config.mjs";
import { resolveApiUrl } from "./worktree-ports.mjs";

const ROOT_DIR = process.cwd();
const DUPLICATE_USER_ERROR =
  /already (?:registered|exists)|has already been registered|duplicate key|Database error creating new user/i;

export const DEFAULT_AUTH_USERS_EXAMPLE_PATH = getAuthUsersExamplePath(ROOT_DIR);
export const DEFAULT_AUTH_USERS_LOCAL_PATH = getAuthUsersLocalPath(
  ROOT_DIR,
  process.env,
);

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const firstEq = trimmed.indexOf("=");
  if (firstEq === -1) return null;

  const key = trimmed.slice(0, firstEq).trim();
  if (!key) return null;

  let value = trimmed.slice(firstEq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return [key, value];
}

export function generateAuthSeedPassword() {
  return `Local-${randomBytes(12).toString("hex")}-Aa1!`;
}

async function loadDotEnvLocal(rootDir = ROOT_DIR) {
  const envPath = getBaseEnvPath(rootDir, process.env);
  let contents;
  try {
    contents = await fs.readFile(envPath, "utf-8");
  } catch {
    return;
  }

  for (const line of contents.split(/\r?\n/u)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (!process.env[key]) process.env[key] = value;
  }
}

async function readUsersFile(filePath, required) {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    if (required) {
      throw new Error(`Missing auth users config: ${filePath}`);
    }
    return null;
  }
}

function validateUsersShape(parsed, filePath, requirePasswords) {
  const users = Array.isArray(parsed) ? parsed : parsed?.users;
  if (!Array.isArray(users)) {
    throw new Error(`Auth users config must contain a users array: ${filePath}`);
  }

  for (const [index, user] of users.entries()) {
    if (!user || typeof user !== "object") {
      throw new Error(`Invalid auth user at index ${index}: expected object`);
    }

    if (typeof user.email !== "string" || user.email.trim().length === 0) {
      throw new Error(`Invalid auth user at index ${index}: missing email`);
    }

    if (
      user.email_confirm !== undefined &&
      typeof user.email_confirm !== "boolean"
    ) {
      throw new Error(
        `Invalid auth user at index ${index}: email_confirm must be boolean when provided`,
      );
    }

    if (
      requirePasswords &&
      (typeof user.password !== "string" || user.password.length < 6)
    ) {
      throw new Error(
        `Invalid auth user at index ${index}: password must be at least 6 chars`,
      );
    }
  }

  return users.map((user) => ({
    email: user.email.trim(),
    email_confirm: user.email_confirm,
    password: typeof user.password === "string" ? user.password : undefined,
  }));
}

export async function loadAuthUsersConfig(
  filePath,
  { required = false, requirePasswords = true } = {},
) {
  const raw = await readUsersFile(filePath, required);
  if (raw === null) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in auth users config: ${filePath}`);
  }

  return validateUsersShape(parsed, filePath, requirePasswords);
}

export function formatGeneratedAuthUsersNotice(rootDir, localPath, users) {
  const displayPath = formatResolvedLocalConfigPath(rootDir, localPath);
  const credentials = users
    .map((user) => `- ${user.email} / ${user.password}`)
    .join("\n");

  return [
    `Created local auth seed file: ${displayPath}`,
    "Generated local credentials:",
    credentials,
  ].join("\n");
}

export async function ensureLocalAuthUsersFile({
  localPath = DEFAULT_AUTH_USERS_LOCAL_PATH,
  examplePath = DEFAULT_AUTH_USERS_EXAMPLE_PATH,
} = {}) {
  const existingUsers = await loadAuthUsersConfig(localPath, {
    required: false,
    requirePasswords: true,
  });
  if (existingUsers) {
    return { created: false, localPath, users: existingUsers };
  }

  const exampleUsers = await loadAuthUsersConfig(examplePath, {
    required: true,
    requirePasswords: false,
  });

  const generatedUsers = exampleUsers.map((user) => ({
    email: user.email,
    email_confirm: user.email_confirm ?? true,
    password: generateAuthSeedPassword(),
  }));

  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(
    localPath,
    `${JSON.stringify({ users: generatedUsers }, null, 2)}\n`,
    "utf-8",
  );

  return { created: true, localPath, users: generatedUsers };
}

export async function seedAuthUsers({ supabaseUrl, serviceRoleKey, users }) {
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let createdCount = 0;
  let existingCount = 0;

  for (const user of users) {
    const { error } = await admin.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: user.email_confirm ?? true,
    });

    if (!error) {
      createdCount += 1;
      continue;
    }

    if (DUPLICATE_USER_ERROR.test(error.message)) {
      existingCount += 1;
      continue;
    }

    throw new Error(`Failed to create ${user.email}: ${error.message}`);
  }

  return { createdCount, existingCount };
}

export async function main() {
  await loadDotEnvLocal();

  const supabaseUrl = process.env.API_URL || resolveApiUrl();
  const serviceRoleKey = process.env.SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      `Missing SERVICE_ROLE_KEY (expected in env or ${formatResolvedLocalConfigPath(ROOT_DIR, getBaseEnvPath(ROOT_DIR, process.env))})`,
    );
  }

  const { created, localPath, users } = await ensureLocalAuthUsersFile();
  if (created) {
    console.log(formatGeneratedAuthUsersNotice(ROOT_DIR, localPath, users));
  }

  const result = await seedAuthUsers({ supabaseUrl, serviceRoleKey, users });
  console.log(
    `Using local auth user config: ${formatResolvedLocalConfigPath(ROOT_DIR, localPath)}`,
  );
  console.log(
    `Ensured ${users.length} auth user(s): created=${result.createdCount}, existing=${result.existingCount}`,
  );
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isMainModule()) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
