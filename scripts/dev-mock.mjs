import path from "node:path";
import {
  npmBin,
  loadEnvFile,
  runCommand,
  smartStartSupabase,
} from "./supabase-utils.mjs";

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

  console.log('Starting local stack in "mock" AI mode...');
  await smartStartSupabase(rootDir, "mock", env);
  runCommand(npmBin, ["run", "seed:storage"], env);
  runCommand(npmBin, ["-w", "web", "run", "dev"], env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
