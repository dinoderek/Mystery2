import { getBaseEnvPath } from "./local-config.mjs";
import {
  ensureSupabaseRunning,
  injectWorktreeEnv,
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
  const env = injectWorktreeEnv({ ...baseVars, ...process.env });

  await ensureSupabaseRunning(env, { restart: options.restart });

  console.log("--- seed:auth ---");
  runCommand(npmBin, ["run", "seed:auth"], env);

  console.log("--- seed:ai ---");
  if (options.seedAI) {
    runCommand(npmBin, ["run", "seed:ai"], env);
  } else {
    console.log("(skipped)");
  }

  console.log("--- seed:storage (blueprints + images) ---");
  if (options.seedStorage !== "skip") {
    runCommand(npmBin, ["run", "seed:storage"], env);
  } else {
    console.log("(skipped)");
  }

  console.log("All seeds complete.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
