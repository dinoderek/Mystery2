import path from "node:path";
import {
  npmBin,
  loadEnvFile,
  runCommand,
  smartStartSupabase,
} from "./supabase-utils.mjs";

const mode = process.argv[2];
if (mode !== "free" && mode !== "paid") {
  console.error("Usage: node scripts/dev-ai.mjs <free|paid>");
  process.exit(1);
}

const rootDir = process.cwd();
const baseEnvPath = path.join(rootDir, ".env.local");
const modeEnvPath = path.join(rootDir, `.env.ai.${mode}.local`);

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
  await smartStartSupabase(rootDir, mode, env);
  runCommand(npmBin, ["run", "seed:storage"], env);
  runCommand(npmBin, ["-w", "web", "run", "dev"], env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
