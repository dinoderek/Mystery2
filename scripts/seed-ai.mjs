import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  formatResolvedLocalConfigPath,
  getAIEnvPath,
  getBaseEnvPath,
} from "./local-config.mjs";
import { loadEnvFile } from "./supabase-utils.mjs";

const ROOT_DIR = process.cwd();
const CANONICAL_DEFAULT_PROFILE_ID = "default";
const VALID_PROFILES = new Set(["mock", "free", "paid"]);

function parseOnlyArg(args) {
  const inline = args.find((arg) => arg.startsWith("--only="));
  if (inline) {
    return inline.slice("--only=".length).trim();
  }

  const index = args.findIndex((arg) => arg === "--only");
  if (index === -1) {
    return null;
  }

  return args[index + 1]?.trim() ?? "";
}

function resolveTargets(args) {
  const only = parseOnlyArg(args);
  if (!only) {
    return { only: null, targets: ["mock", "free", "paid"] };
  }

  if (!VALID_PROFILES.has(only)) {
    throw new Error(`Invalid --only value "${only}". Use one of: mock, free, paid.`);
  }

  return { only, targets: [only] };
}

function parseProvider(rawProvider, modeEnvPath) {
  if (rawProvider === "mock" || rawProvider === "openrouter") {
    return rawProvider;
  }
  throw new Error(
    `Invalid AI_PROVIDER in ${path.basename(modeEnvPath)}. Expected "mock" or "openrouter".`,
  );
}

async function loadModeProfile(rootEnv, mode) {
  if (mode === "mock") {
    return {
      id: "mock",
      provider: "mock",
      model: "mock/runtime-default",
      openrouter_api_key: null,
    };
  }

  const modeEnvPath = getAIEnvPath(ROOT_DIR, mode, process.env);
  const modeEnv = await loadEnvFile(modeEnvPath, false);
  if (Object.keys(modeEnv).length === 0) {
    return null;
  }

  const provider = parseProvider(modeEnv.AI_PROVIDER?.trim(), modeEnvPath);
  const model = modeEnv.AI_MODEL?.trim();
  if (!model) {
    throw new Error(`Missing AI_MODEL in ${path.basename(modeEnvPath)}.`);
  }

  const openrouterKey = modeEnv.OPENROUTER_API_KEY?.trim() ||
    rootEnv.OPENROUTER_API_KEY?.trim() ||
    null;

  if (provider === "openrouter" && !openrouterKey) {
    throw new Error(
      `Missing OPENROUTER_API_KEY for profile "${mode}" in ${formatResolvedLocalConfigPath(ROOT_DIR, modeEnvPath)} or ${formatResolvedLocalConfigPath(ROOT_DIR, getBaseEnvPath(ROOT_DIR, process.env))}.`,
    );
  }

  return {
    id: mode,
    provider,
    model,
    openrouter_api_key: provider === "openrouter" ? openrouterKey : null,
  };
}

function chooseDefaultSource(targets, profileMap) {
  if (targets.length === 1) {
    return profileMap.get(targets[0]) ?? null;
  }

  return profileMap.get("mock") ?? profileMap.get(targets[0]) ?? null;
}

const { only, targets } = resolveTargets(process.argv.slice(2));
const baseEnvPath = getBaseEnvPath(ROOT_DIR, process.env);
const baseEnv = await loadEnvFile(baseEnvPath, false);
const env = { ...baseEnv, ...process.env };

const supabaseUrl = env.API_URL || "http://127.0.0.1:54331";
const serviceRoleKey = env.SERVICE_ROLE_KEY;
if (!serviceRoleKey) {
  console.error(
    `Missing SERVICE_ROLE_KEY (expected in env or ${formatResolvedLocalConfigPath(ROOT_DIR, baseEnvPath)})`,
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const profileMap = new Map();
for (const target of targets) {
  const profile = await loadModeProfile(env, target);
  if (!profile) {
    if (only) {
      throw new Error(
        `Missing required AI profile env file for --only ${target}: ${formatResolvedLocalConfigPath(ROOT_DIR, getAIEnvPath(ROOT_DIR, target, process.env))}`,
      );
    }
    console.warn(
      `Skipping profile "${target}": missing ${formatResolvedLocalConfigPath(ROOT_DIR, getAIEnvPath(ROOT_DIR, target, process.env))}`,
    );
    continue;
  }
  profileMap.set(target, profile);
}

const defaultSource = chooseDefaultSource(targets, profileMap);
if (!defaultSource) {
  console.warn("No AI profiles were seeded.");
  process.exit(0);
}

const now = new Date().toISOString();
const payload = [
  ...profileMap.values(),
  {
    id: CANONICAL_DEFAULT_PROFILE_ID,
    provider: defaultSource.provider,
    model: defaultSource.model,
    openrouter_api_key: defaultSource.openrouter_api_key,
  },
].map((row) => ({ ...row, updated_at: now }));

const { error } = await supabase
  .from("ai_profiles")
  .upsert(payload, { onConflict: "id" });

if (error) {
  console.error(`Failed to seed AI profiles: ${error.message}`);
  process.exit(1);
}

console.log(
  `Seeded AI profiles: ${payload.map((row) => row.id).join(", ")}`,
);
