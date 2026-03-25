import { getBaseEnvPath } from "./local-config.mjs";
import {
  ensureSupabaseRunning,
  injectWorktreeEnv,
  loadEnvFile,
} from "./supabase-utils.mjs";

const rootDir = process.cwd();
const baseVars = await loadEnvFile(getBaseEnvPath(rootDir, process.env), false);
const env = injectWorktreeEnv({ ...baseVars, ...process.env });

console.log("Restarting supabase...");
await ensureSupabaseRunning(env, { restart: true });
console.log("Done.");
