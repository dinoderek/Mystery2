import { getAIEnvPath, getBaseEnvPath } from "./local-config.mjs";
import { loadEnvFile, npmBin, runCommand } from "./supabase-utils.mjs";

const mode = process.argv[2];
if (mode !== "free" && mode !== "paid") {
  console.error("Usage: node scripts/run-live-blueprint-generation.mjs <free|paid>");
  process.exit(1);
}

const rootDir = process.cwd();
const baseEnvPath = getBaseEnvPath(rootDir, process.env);
const modeEnvPath = getAIEnvPath(rootDir, mode, process.env);

try {
  const baseVars = await loadEnvFile(baseEnvPath, false);
  const modeVars = await loadEnvFile(modeEnvPath, true);
  const env = {
    ...baseVars,
    ...modeVars,
    ...process.env,
  };

  if (!env.AI_MODEL) {
    throw new Error("Missing AI_MODEL in env configuration.");
  }
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("Missing OPENROUTER_API_KEY in env configuration.");
  }

  const liveTestTimeout = env.AI_LIVE_TEST_TIMEOUT_MS || "600000";
  const runEnv = {
    ...env,
    AI_LIVE: "1",
    AI_LIVE_LABEL: mode,
    AI_LIVE_TEST_TIMEOUT_MS: liveTestTimeout,
  };

  runCommand(
    npmBin,
    [
      "exec",
      "--",
      "vitest",
      "run",
      "tests/api/integration/live-ai/live-blueprint-generator.test.ts",
      "--testTimeout",
      liveTestTimeout,
    ],
    runEnv,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
