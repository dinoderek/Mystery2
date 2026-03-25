import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import {
  patchConfigToml,
  resolveWorktreePorts,
} from "./worktree-ports.mjs";
import { gcWorktreeSupabase } from "./gc-worktree-supabase.mjs";

export const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";
export const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

export function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const firstEq = trimmed.indexOf("=");
  if (firstEq === -1) return null;

  const key = trimmed.slice(0, firstEq).trim();
  if (!key) return null;

  let value = trimmed.slice(firstEq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return [key, value];
}

export async function loadEnvFile(filePath, required = false) {
  let contents;
  try {
    contents = await fs.readFile(filePath, "utf-8");
  } catch {
    if (required) {
      throw new Error(`Missing required env file: ${filePath}`);
    }
    return {};
  }

  const vars = {};
  for (const line of contents.split(/\r?\n/u)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    vars[key] = value;
  }
  return vars;
}

export function runCommand(command, args, env, allowFailure = false) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
  });

  if (result.error) throw result.error;
  if (allowFailure) return;
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

export function isSupabaseRunning(env) {
  const result = spawnSync(npxBin, ["supabase", "status"], {
    stdio: "pipe",
    env,
  });
  return (result.status ?? 1) === 0;
}

export async function ensureSupabaseRunning(env, options = {}) {
  const { restart = false } = options;

  // --- Worktree isolation: patch config and garbage-collect orphans ----------
  const resolved = resolveWorktreePorts();
  if (resolved.isWorktree) {
    const patched = patchConfigToml();
    if (patched) {
      console.log(
        `Worktree detected (${resolved.worktreeName}): patched config.toml → ` +
        `project_id=${resolved.projectId}, API port=${resolved.ports.api}`,
      );
    }
  }

  // Opportunistic GC: remove Supabase stacks from deleted worktrees.
  try {
    gcWorktreeSupabase(process.cwd(), { verbose: false });
  } catch {
    // Non-fatal — GC is best-effort.
  }
  // --------------------------------------------------------------------------

  const running = isSupabaseRunning(env);

  if (restart) {
    console.log("Restarting supabase...");
    runCommand(npxBin, ["supabase", "stop"], env, true);
    runCommand(npxBin, ["supabase", "start"], env);
    return;
  }

  if (running) {
    console.log("Supabase already running — skipping restart.");
    return;
  }
  console.log("Starting supabase...");
  runCommand(npxBin, ["supabase", "start"], env);
}

/**
 * Inject worktree-derived Supabase URL and Vite dev port into an env object
 * so that child processes (seed scripts, test runners, dev server) use the
 * correct ports.
 *
 * In a worktree the derived values are **authoritative** — they override any
 * inherited values so that scripts can never accidentally target the main
 * checkout's Supabase instance or Vite port.  In the main checkout, existing
 * values are preserved as before.
 */
export function injectWorktreeEnv(env) {
  const resolved = resolveWorktreePorts();
  const apiUrl = `http://127.0.0.1:${resolved.ports.api}`;

  if (resolved.isWorktree) {
    return {
      ...env,
      API_URL: apiUrl,
      SUPABASE_URL: apiUrl,
      VITE_SUPABASE_URL: apiUrl,
      VITE_DEV_PORT: String(resolved.ports.vite_dev),
    };
  }

  return {
    ...env,
    API_URL: env.API_URL || apiUrl,
    SUPABASE_URL: env.SUPABASE_URL || apiUrl,
    VITE_SUPABASE_URL: env.VITE_SUPABASE_URL || apiUrl,
    VITE_DEV_PORT: env.VITE_DEV_PORT || String(resolved.ports.vite_dev),
  };
}

function parseSeedStorageArg(value) {
  if (!value || value === "if-missing") return "if-missing";
  if (value === "always") return "always";
  if (value === "skip") return "skip";
  throw new Error(
    `Invalid --seed-storage value "${value}". Use one of: if-missing, always, skip.`,
  );
}

function parseSeedImagesArg(value) {
  if (!value || value === "skip") return "skip";
  if (value === "if-missing") return "if-missing";
  if (value === "always") return "always";
  throw new Error(
    `Invalid --seed-images value "${value}". Use one of: skip, if-missing, always.`,
  );
}

export function parseScriptOptions(args) {
  const options = {
    restart: false,
    seedStorage: "if-missing",
    seedImages: "skip",
    imageDir: null,
    seedAI: true,
  };

  for (const arg of args) {
    if (arg === "--restart") {
      options.restart = true;
      continue;
    }
    if (arg === "--skip-seed-ai" || arg === "--seed-ai=skip") {
      options.seedAI = false;
      continue;
    }
    if (arg === "--seed-ai") {
      options.seedAI = true;
      continue;
    }
    if (arg === "--skip-seed-storage") {
      options.seedStorage = "skip";
      continue;
    }
    if (arg === "--seed-storage") {
      options.seedStorage = "always";
      continue;
    }
    if (arg.startsWith("--seed-storage=")) {
      options.seedStorage = parseSeedStorageArg(arg.slice("--seed-storage=".length));
      continue;
    }
    if (arg === "--seed-images") {
      options.seedImages = "always";
      continue;
    }
    if (arg === "--skip-seed-images") {
      options.seedImages = "skip";
      continue;
    }
    if (arg.startsWith("--seed-images=")) {
      options.seedImages = parseSeedImagesArg(arg.slice("--seed-images=".length));
      continue;
    }
    if (arg.startsWith("--image-dir=")) {
      options.imageDir = arg.slice("--image-dir=".length);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}
