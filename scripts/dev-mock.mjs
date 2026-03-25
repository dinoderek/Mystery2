import { getBaseEnvPath } from "./local-config.mjs";
import {
  ensureSupabaseRunning,
  injectWorktreeEnv,
  npmBin,
  loadEnvFile,
  parseScriptOptions,
  runCommand,
} from "./supabase-utils.mjs";

const rootDir = process.cwd();
const baseEnvPath = getBaseEnvPath(rootDir, process.env);
const options = parseScriptOptions(process.argv.slice(2));

try {
  const baseVars = await loadEnvFile(baseEnvPath, false);
  const env = injectWorktreeEnv({
    ...baseVars,
    ...process.env,
  });

  console.log('Starting local stack with AI profile "default" (mock config)...');
  await ensureSupabaseRunning(env, { restart: options.restart });
  if (options.seedStorage === "always") {
    runCommand(npmBin, ["run", "seed:storage"], env);
  } else if (options.seedStorage === "if-missing") {
    runCommand(npmBin, ["run", "seed:storage", "--", "--if-missing"], env);
  }
  if (options.seedAI) {
    runCommand(npmBin, ["run", "seed:ai", "--", "--only", "mock"], env);
  }
  runCommand(npmBin, ["-w", "web", "run", "dev"], env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
