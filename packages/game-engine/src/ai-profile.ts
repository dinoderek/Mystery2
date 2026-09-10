// `AIProfileStore` over the environment and the settings database.
//
// Four profiles, resolved per request:
//
//   mock            built in; no configuration, no key
//   free / paid     `.env.ai.<mode>.local`, unchanged — these are what the
//                   live-AI suites and the evaluation harness name explicitly
//   default         what the browser plays as, since the UI never sends an
//                   `ai_profile`. Resolved in this order:
//
//                     1. `AI_PROVIDER` + `AI_MODEL` in the process environment,
//                        so `npm run dev:ai:free` still puts the UI on a live
//                        model and the mock test server stays mock by absence
//                     2. the settings database — what was last chosen on the
//                        settings page, and the only one a player can change
//                     3. mock
//
//                   Step 1 outranking step 2 is why the settings page shows an
//                   override banner: a stored choice that is quietly not in
//                   effect is worse than no setting at all. `readProcessAIOverride`
//                   backs both the banner and the branch, so they cannot disagree.
//
// A session still records the profile *label* it was started with
// (`game_sessions.ai_profile_id`), because the evaluation pipeline reads it;
// the model actually used is on each event's `model` column.

import { getAIEnvPath, getBaseEnvPath } from "../../../scripts/local-config.mjs";
import {
  DEFAULT_AI_PROFILE_ID,
  type AIProfileStore,
  type AISettingsStore,
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
  /**
   * Where the `default` profile reads its stored choice from. Omitted by
   * callers that only resolve `mock`/`free`/`paid`, in which case `default`
   * falls through to mock exactly as it did before settings existed.
   */
  settings?: AISettingsStore;
}

/** An AI configuration forced by the process environment, if there is one. */
export interface ProcessAIOverride {
  provider: "mock" | "openrouter";
  model: string;
}

/**
 * The override the process was started with, or null.
 *
 * Only the two variables that *select* a configuration count.
 * `OPENROUTER_API_KEY` alone is not an override — a machine can have a key in
 * `.env.local` and still want whatever the settings page says — so it is read
 * as a fallback secret, never as a signal.
 *
 * Deliberately shared between `resolveAIProfile` below and the settings
 * endpoint that renders the banner: if the banner said "no override" while the
 * runtime applied one, the page would be lying about the only thing it exists
 * to show.
 */
export function readProcessAIOverride(
  env: EnvRecord = process.env,
): ProcessAIOverride | null {
  if (!env.AI_PROVIDER && !env.AI_MODEL) return null;

  const provider = readProvider(env.AI_PROVIDER);
  const model = env.AI_MODEL?.trim();
  if (!provider || !model) return null;

  return { provider, model };
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
 * Same layering the dev and seed scripts use: `.env.local` provides the
 * baseline, the process environment overrides it.
 */
function layerEnv(repoRoot: string, processEnv: EnvRecord): EnvRecord {
  return { ...readEnvFile(getBaseEnvPath(repoRoot, processEnv)), ...processEnv };
}

/**
 * The override in effect for the `default` profile, or null.
 *
 * Reads through the same layering `resolveAIProfile` does, so the banner on the
 * settings page and the branch the runtime actually takes can never disagree
 * about whether the stored choice is being bypassed.
 */
export function readDefaultAIOverride(
  options: LocalAIProfileOptions = {},
): ProcessAIOverride | null {
  const repoRoot = options.repoRoot ?? process.cwd();
  const processEnv = options.env ?? process.env;
  return readProcessAIOverride(layerEnv(repoRoot, processEnv));
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
  const env = layerEnv(repoRoot, processEnv);
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
    // 1. Whatever this process was started with. `npm run dev` leaves these
    //    unset; `npm run dev:ai:free` sets them from the free file. Throws
    //    rather than falling back when they describe something unusable — a
    //    typo in an explicit override must not silently become mock.
    const fromProcess = profileFromVars(
      DEFAULT_AI_PROFILE_ID,
      env,
      keyFallback,
      "the environment",
    );
    if (fromProcess) return fromProcess;

    // 2. The stored choice. A dangling selection has already been resolved to
    //    mock by `resolve()`, so there is nothing unusable to guard against.
    const stored = options.settings?.resolve();
    if (stored?.mode === "openrouter" && stored.key && stored.model) {
      return {
        id: DEFAULT_AI_PROFILE_ID,
        provider: "openrouter",
        model: stored.model.model_id,
        openrouter_api_key: stored.key.api_key,
      };
    }

    // 3. Mock.
    return mockProfile(DEFAULT_AI_PROFILE_ID);
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
