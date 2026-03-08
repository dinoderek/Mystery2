import path from "node:path";
import {
  loadEnvFile,
  npmBin,
  runCommand,
  smartStartSupabase,
} from "./supabase-utils.mjs";

const suite = process.argv[2];
const mode = process.argv[3];

if ((suite !== "integration" && suite !== "e2e") || (mode !== "free" && mode !== "paid")) {
  console.error("Usage: node scripts/run-live-ai.mjs <integration|e2e> <free|paid>");
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

  const vitestTarget = suite === "integration"
    ? "tests/api/integration/live-ai"
    : "tests/api/e2e/live-ai-flow.test.ts";
  const label = mode;
  const liveTestTimeout = env.AI_LIVE_TEST_TIMEOUT_MS || "600000";
  const runEnv = {
    ...env,
    AI_LIVE: "1",
    AI_LIVE_LABEL: label,
    AI_LIVE_TEST_TIMEOUT_MS: liveTestTimeout,
  };

  console.log(`Running ${suite} live AI tests in "${mode}" mode...`);
  await smartStartSupabase(rootDir, mode, env, { forceRestart: true });
  runCommand(npmBin, ["run", "seed:storage"], env);
  runCommand(
    npmBin,
    [
      "exec",
      "--",
      "vitest",
      "run",
      vitestTarget,
      "--testTimeout",
      liveTestTimeout,
    ],
    runEnv,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
