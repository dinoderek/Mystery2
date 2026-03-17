import path from "node:path";
import {
  ensureSupabaseRunning,
  loadEnvFile,
  npmBin,
  parseScriptOptions,
  runCommand,
} from "./supabase-utils.mjs";

const suite = process.argv[2];
if (suite !== "integration" && suite !== "e2e") {
  console.error("Usage: node scripts/run-mock-tests.mjs <integration|e2e>");
  process.exit(1);
}
const options = parseScriptOptions(process.argv.slice(3));

const rootDir = process.cwd();
const baseEnvPath = path.join(rootDir, ".env.local");

try {
  const baseVars = await loadEnvFile(baseEnvPath, false);
  const env = {
    ...baseVars,
    ...process.env,
  };

  const vitestTarget =
    suite === "integration" ? "tests/api/integration" : "tests/api/e2e";

  console.log(`Running ${suite} tests in "mock" AI mode...`);
  await ensureSupabaseRunning(env, { restart: options.restart });
  runCommand(npmBin, ["run", "seed:storage"], env);
  if (options.seedAI) {
    runCommand(npmBin, ["run", "seed:ai", "--", "--only", "mock"], env);
  }
  runCommand(npmBin, ["exec", "--", "vitest", "run", vitestTarget], env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
