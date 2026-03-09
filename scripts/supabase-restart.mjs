import path from "node:path";
import {
  ensureSupabaseRunning,
  loadEnvFile,
} from "./supabase-utils.mjs";

const rootDir = process.cwd();
const baseVars = await loadEnvFile(path.join(rootDir, ".env.local"), false);
const env = { ...baseVars, ...process.env };

console.log("Restarting supabase...");
await ensureSupabaseRunning(env, { restart: true });
console.log("Done.");
