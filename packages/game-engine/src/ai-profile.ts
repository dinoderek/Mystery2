// `AIProfileStore` over the environment.
//
// Three profiles, resolved per request from the environment:
//
//   mock            built in; no configuration, no key
//   free / paid     `.env.ai.<mode>.local`, as `npm run seed:ai` reads today
//   default         whatever the running process is configured with, so
//                   `dev:ai:free` / `dev:ai:paid` still switch models — now
//                   without a database round-trip or a restart
//
// A session still records the profile *label* it was started with
// (`game_sessions.ai_profile_id`), because the evaluation pipeline reads it;
// the model actually used is on each event's `model` column.

import { getAIEnvPath, getBaseEnvPath } from "../../../scripts/local-config.mjs";
import {
  DEFAULT_AI_PROFILE_ID,
  type AIProfileStore,
  type EngineAIProfile,
} from "./context.ts";
import { readEnvFile, type EnvRecord } from "./env-file.ts";

export const MOCK_AI_PROFILE_ID = "mock";
const MOCK_MODEL = "mock/runtime-default";

/** Profiles backed by a `.env.ai.<mode>.local` file. */
const FILE_BACKED_PROFILE_IDS = ["free", "paid"] as const;

export interface LocalAIProfileOptions {
  repoRoot?: string;
  /** Process environment; `.env.local` is layered underneath it. */
  env?: EnvRecord;
}

function mockProfile(id: string): EngineAIProfile {
  return {
    id,
    provider: "mock",
    model: MOCK_MODEL,
    openrouter_api_key: null,
  };
}

function readProvider(value: string | undefined): "mock" | "openrouter" | null {
  const trimmed = value?.trim();
  return trimmed === "mock" || trimmed === "openrouter" ? trimmed : null;
}

/**
 * Builds a profile from a set of variables, or returns null when they do not
 * describe one at all.
 *
 * @throws when the variables describe a profile that cannot work — an
 * unrecognised provider, a missing model, or `openrouter` with no key. Those
 * are configuration errors, not absences, and the contract's convention is
 * that a genuine failure throws while "does not exist" returns null.
 */
function profileFromVars(
  id: string,
  vars: EnvRecord,
  keyFallback: string | null,
  source: string,
): EngineAIProfile | null {
  if (!vars.AI_PROVIDER && !vars.AI_MODEL) return null;

  const provider = readProvider(vars.AI_PROVIDER);
  if (!provider) {
    throw new Error(
      `Invalid AI_PROVIDER in ${source}. Expected "mock" or "openrouter".`,
    );
  }

  const model = vars.AI_MODEL?.trim();
  if (!model) throw new Error(`Missing AI_MODEL in ${source}.`);

  if (provider === "mock") {
    return { id, provider, model, openrouter_api_key: null };
  }

  const key = vars.OPENROUTER_API_KEY?.trim() || keyFallback;
  if (!key) {
    throw new Error(
      `Missing OPENROUTER_API_KEY for AI_PROVIDER=openrouter in ${source}.`,
    );
  }

  return { id, provider, model, openrouter_api_key: key };
}

/**
 * Resolves one profile by the id a request names. Returns null for an id that
 * is not configured, which handlers turn into `400 Invalid ai_profile`.
 */
export function resolveAIProfile(
  profileId: string,
  options: LocalAIProfileOptions = {},
): EngineAIProfile | null {
  const trimmedId = profileId.trim();
  if (!trimmedId) return null;

  const repoRoot = options.repoRoot ?? process.cwd();
  const processEnv = options.env ?? process.env;
  // Same layering the dev and seed scripts use: `.env.local` provides the
  // baseline, the process environment overrides it.
  const baseEnv = readEnvFile(getBaseEnvPath(repoRoot, processEnv));
  const env: EnvRecord = { ...baseEnv, ...processEnv };
  const keyFallback = env.OPENROUTER_API_KEY?.trim() || null;

  if (trimmedId === MOCK_AI_PROFILE_ID) return mockProfile(MOCK_AI_PROFILE_ID);

  if ((FILE_BACKED_PROFILE_IDS as readonly string[]).includes(trimmedId)) {
    const envPath = getAIEnvPath(repoRoot, trimmedId, processEnv);
    const vars = readEnvFile(envPath);
    // No file at all means the profile is not configured on this machine.
    if (Object.keys(vars).length === 0) return null;
    return profileFromVars(trimmedId, vars, keyFallback, envPath);
  }

  if (trimmedId === DEFAULT_AI_PROFILE_ID) {
    // Whatever this process was started with — `npm run dev` leaves these
    // unset and gets mock, `npm run dev:ai:free` sets them from the free file.
    return (
      profileFromVars(DEFAULT_AI_PROFILE_ID, env, keyFallback, "the environment") ??
      mockProfile(DEFAULT_AI_PROFILE_ID)
    );
  }

  return null;
}

export function createLocalAIProfileStore(
  options: LocalAIProfileOptions = {},
): AIProfileStore {
  return {
    async getById(profileId: string): Promise<EngineAIProfile | null> {
      return resolveAIProfile(profileId, options);
    },
  };
}
