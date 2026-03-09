import { createClient } from "@supabase/supabase-js";
import fs from "fs/promises";
import path from "path";

const ROOT_DIR = process.cwd();
const TEST_USERS = [
  { email: "player1@test.local", password: "password123" },
  { email: "player2@test.local", password: "password123" },
];

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

async function loadDotEnvLocal() {
  const envPath = path.join(ROOT_DIR, ".env.local");
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

await loadDotEnvLocal();

const supabaseUrl = process.env.API_URL || "http://127.0.0.1:54331";
const serviceRoleKey = process.env.SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  console.error("Missing SERVICE_ROLE_KEY (expected in env or .env.local)");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

for (const user of TEST_USERS) {
  const { error } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });

  if (
    error &&
    !/already (?:registered|exists)|has already been registered|duplicate key|Database error creating new user/i.test(
      error.message,
    )
  ) {
    console.error(`Failed to create ${user.email}: ${error.message}`);
    process.exit(1);
  }
}

console.log(
  `Ensured ${TEST_USERS.length} auth user(s): ${TEST_USERS.map((u) => u.email).join(", ")}`,
);
