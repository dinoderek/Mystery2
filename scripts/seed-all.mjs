import { getBaseEnvPath } from "./local-config.mjs";
import { loadEnvFile, npmBin, runCommand } from "./supabase-utils.mjs";

const rootDir = process.cwd();
const baseEnvPath = getBaseEnvPath(rootDir, process.env);
const baseEnv = await loadEnvFile(baseEnvPath, false);
const env = { ...baseEnv, ...process.env };

try {
  console.log("--- seed:auth ---");
  runCommand(npmBin, ["run", "seed:auth"], env);

  console.log("--- seed:ai ---");
  runCommand(npmBin, ["run", "seed:ai"], env);

  console.log("--- seed:storage (blueprints + images) ---");
  runCommand(npmBin, ["run", "seed:storage"], env);

  console.log("All seeds complete.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
