import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const mode = process.argv[2];
if (mode !== "free" && mode !== "paid") {
  console.error("Usage: node scripts/dev-ai.mjs <free|paid>");
  process.exit(1);
}

const rootDir = process.cwd();
const baseEnvPath = path.join(rootDir, ".env.local");
const modeEnvPath = path.join(rootDir, `.env.ai.${mode}.local`);

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

async function loadEnvFile(filePath, required = false) {
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

function runCommand(command, args, env, allowFailure = false) {
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

const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  const baseVars = await loadEnvFile(baseEnvPath, false);
  const modeVars = await loadEnvFile(modeEnvPath, true);
  const env = {
    ...baseVars,
    ...modeVars,
    ...process.env,
  };

  if (!env.AI_PROVIDER) {
    throw new Error("Missing AI_PROVIDER in env configuration.");
  }
  if (!env.AI_MODEL) {
    throw new Error("Missing AI_MODEL in env configuration.");
  }
  if (env.AI_PROVIDER === "openrouter" && !env.OPENROUTER_API_KEY) {
    throw new Error(
      "Missing OPENROUTER_API_KEY for AI_PROVIDER=openrouter in env configuration.",
    );
  }

  console.log(`Starting local stack in "${mode}" AI mode...`);
  runCommand(npxBin, ["supabase", "stop"], env, true);
  runCommand(npxBin, ["supabase", "start"], env);
  runCommand(npmBin, ["run", "seed:storage"], env);
  runCommand(npmBin, ["-w", "web", "run", "dev"], env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
