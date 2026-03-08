import path from "node:path";
import {
  loadEnvFile,
  npmBin,
  runCommand,
  smartStartSupabase,
} from "./supabase-utils.mjs";

const suite = process.argv[2];
if (suite !== "integration" && suite !== "e2e") {
  console.error("Usage: node scripts/run-mock-tests.mjs <integration|e2e>");
  process.exit(1);
}

const rootDir = process.cwd();
const baseEnvPath = path.join(rootDir, ".env.local");

try {
  const baseVars = await loadEnvFile(baseEnvPath, false);
  const env = {
    ...baseVars,
    ...process.env,
    AI_PROVIDER: "mock",
    AI_MODEL: "mock/runtime-default",
  };

  const vitestTarget =
    suite === "integration" ? "tests/api/integration" : "tests/api/e2e";

  console.log(`Running ${suite} tests in "mock" AI mode...`);
  await smartStartSupabase(rootDir, "mock", env, { forceRestart: true });
  runCommand(npmBin, ["run", "seed:storage"], env);
  runCommand(npmBin, ["exec", "--", "vitest", "run", vitestTarget], env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
