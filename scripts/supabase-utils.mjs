import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";
export const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

const AI_MODE_FILE = ".supabase-ai-mode";

export function parseEnvLine(line) {
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

export async function loadEnvFile(filePath, required = false) {
  let contents;
  try {
    contents = await fs.readFile(filePath, "utf-8");
  } catch {
    if (required) {
      throw new Error(`Missing required env file: ${path.basename(filePath)}`);
    }
    return {};
  }

  const vars = {};
  for (const line of contents.split(/\r?\n/u)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    vars[key] = value;
  }
  return vars;
}

export function runCommand(command, args, env, allowFailure = false) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
  });

  if (result.error) throw result.error;
  if (allowFailure) return;
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

export function isSupabaseRunning(env) {
  const result = spawnSync(npxBin, ["supabase", "status"], {
    stdio: "pipe",
    env,
  });
  return (result.status ?? 1) === 0;
}

export async function getRecordedMode(rootDir) {
  try {
    const content = await fs.readFile(path.join(rootDir, AI_MODE_FILE), "utf-8");
    return content.trim() || null;
  } catch {
    return null;
  }
}

export async function writeRecordedMode(rootDir, mode) {
  await fs.writeFile(path.join(rootDir, AI_MODE_FILE), mode, "utf-8");
}

/**
 * Start supabase only if not already running in the desired mode.
 * Writes the mode to .supabase-ai-mode on (re)start.
 */
export async function smartStartSupabase(
  rootDir,
  mode,
  env,
  options = {},
) {
  const { forceRestart = false } = options;
  const recordedMode = await getRecordedMode(rootDir);
  const running = isSupabaseRunning(env);

  if (forceRestart) {
    console.log(`Force restarting supabase in "${mode}" AI mode...`);
    runCommand(npxBin, ["supabase", "stop"], env, true);
    runCommand(npxBin, ["supabase", "start"], env);
    await writeRecordedMode(rootDir, mode);
    return;
  }

  if (running && recordedMode === mode) {
    console.log(`Supabase already running in "${mode}" AI mode — skipping restart.`);
    return;
  }

  if (running) {
    console.log(
      `Supabase running in "${recordedMode ?? "unknown"}" mode, switching to "${mode}"...`,
    );
  } else {
    console.log(`Starting supabase in "${mode}" AI mode...`);
  }

  runCommand(npxBin, ["supabase", "stop"], env, true);
  runCommand(npxBin, ["supabase", "start"], env);
  await writeRecordedMode(rootDir, mode);
}
