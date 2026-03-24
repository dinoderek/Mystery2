import { getBaseEnvPath } from "./local-config.mjs";
import {
  ensureSupabaseRunning,
  loadEnvFile,
  npmBin,
  parseScriptOptions,
  runCommand,
} from "./supabase-utils.mjs";

const rootDir = process.cwd();
const baseEnvPath = getBaseEnvPath(rootDir, process.env);
const options = parseScriptOptions(process.argv.slice(2));

try {
  const baseVars = await loadEnvFile(baseEnvPath, false);
  const env = { ...baseVars, ...process.env };

  await ensureSupabaseRunning(env, { restart: options.restart });

  if (options.seedStorage !== "skip") {
    runCommand(npmBin, ["run", "seed:storage"], env);
  }

  runCommand(npmBin, ["run", "seed:auth"], env);

  if (options.seedAI) {
    runCommand(npmBin, ["run", "seed:ai"], env);
  }

  console.log("Local setup complete.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
