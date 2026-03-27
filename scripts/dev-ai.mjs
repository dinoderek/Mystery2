import { getAIEnvPath, getBaseEnvPath } from "./local-config.mjs";
import {
  ensureSupabaseRunning,
  injectWorktreeEnv,
  npmBin,
  loadEnvFile,
  parseScriptOptions,
  runCommand,
} from "./supabase-utils.mjs";
import { resolveWorktreePorts } from "./worktree-ports.mjs";

const mode = process.argv[2];
if (mode !== "free" && mode !== "paid") {
  console.error("Usage: node scripts/dev-ai.mjs <free|paid>");
  process.exit(1);
}

const rootDir = process.cwd();
const baseEnvPath = getBaseEnvPath(rootDir, process.env);
const modeEnvPath = getAIEnvPath(rootDir, mode, process.env);
const options = parseScriptOptions(process.argv.slice(3));

try {
  const baseVars = await loadEnvFile(baseEnvPath, false);
  const modeVars = await loadEnvFile(modeEnvPath, true);
  const env = injectWorktreeEnv({
    ...baseVars,
    ...modeVars,
    ...process.env,
  });

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

  console.log(`Starting local stack with AI profile "default" (${mode} config)...`);
  await ensureSupabaseRunning(env, { restart: options.restart });
  if (options.seedStorage === "always" || options.seedStorage === "if-missing") {
    runCommand(npmBin, ["run", "seed:storage"], env);
  }
  if (options.seedAI) {
    runCommand(npmBin, ["run", "seed:ai", "--", "--only", mode], env);
  }
  const { ports } = resolveWorktreePorts();
  runCommand(npmBin, ["-w", "web", "run", "dev", "--", "--port", String(ports.vite_dev)], env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
