// The environment half of AI settings: labelled OpenRouter keys and models read
// off the filesystem at startup.
//
// Everything here is pure — paths in, records out — so it tests without a
// database. Applying the result is `db/ai-settings.ts`'s job, and it does so by
// deleting every `source = 'env'` row and re-inserting these, so a label removed
// from a file disappears instead of lingering.

import {
  getAIEnvPath,
  getAISettingsEnvPath,
  getBaseEnvPath,
} from "../../../scripts/local-config.mjs";
import { readEnvFile, type EnvRecord } from "./env-file.ts";

/** Prefix marking a labelled key in `.env.ai.local`. */
const KEY_PREFIX = "OPENROUTER_KEY_";
/** Prefix marking a labelled model in `.env.ai.local`. */
const MODEL_PREFIX = "AI_MODEL_";

/** The `.env.ai.<mode>.local` files that seed a key and model under their own name. */
const MODE_FILE_LABELS = ["free", "paid"] as const;

export interface AIEnvKey {
  label: string;
  api_key: string;
}

export interface AIEnvModel {
  label: string;
  model_id: string;
}

export interface AIEnvSettings {
  keys: AIEnvKey[];
  models: AIEnvModel[];
}

/**
 * Turns an env-var suffix into a label: lowercased, trimmed of stray
 * underscores. `OPENROUTER_KEY_WORK_SPARE` becomes `work_spare`.
 *
 * Returns null for a suffix that is empty once trimmed, which is the only way
 * `OPENROUTER_KEY_=x` can be read — a variable with no label at all.
 */
function toLabel(suffix: string): string | null {
  const label = suffix.trim().toLowerCase().replace(/^_+|_+$/gu, "");
  return label.length > 0 ? label : null;
}

/**
 * Collects `PREFIX_<LABEL>=value` pairs out of one parsed env file.
 *
 * Later files win on a repeated label, which is what lets the dedicated
 * `.env.ai.local` override a name a mode file also used.
 */
function collectPrefixed(
  vars: Record<string, string>,
  prefix: string,
  into: Map<string, string>,
): void {
  for (const [name, rawValue] of Object.entries(vars)) {
    if (!name.startsWith(prefix)) continue;

    const label = toLabel(name.slice(prefix.length));
    const value = rawValue.trim();
    if (!label || !value) continue;

    into.set(label, value);
  }
}

/**
 * Every labelled key and model this machine's environment files describe.
 *
 * Three sources, in increasing precedence:
 *
 *   `.env.local`            `OPENROUTER_API_KEY` becomes the key `default`
 *   `.env.ai.<mode>.local`  the free/paid profiles become key+model `free`/`paid`
 *   `.env.ai.local`         `OPENROUTER_KEY_*` / `AI_MODEL_*`, any number of them
 *
 * The first two exist so a machine that was already configured for
 * `npm run dev:ai:free` has usable choices in the settings page without editing
 * anything. Those same files still back the `free` and `paid` profiles
 * directly (see ai-profile.ts) — this only mirrors them into the picker.
 *
 * `AI_MODEL_` is a prefix of nothing else in these files, but note it would
 * also match a bare `AI_MODEL=` if one were ever suffixed; a plain `AI_MODEL`
 * has no suffix and is skipped by `toLabel`.
 */
export function readAISettingsEnv(
  repoRoot: string = process.cwd(),
  env: EnvRecord = process.env,
): AIEnvSettings {
  const keys = new Map<string, string>();
  const models = new Map<string, string>();

  const baseVars = readEnvFile(getBaseEnvPath(repoRoot, env));
  const baseKey = baseVars.OPENROUTER_API_KEY?.trim();
  if (baseKey) keys.set("default", baseKey);

  for (const label of MODE_FILE_LABELS) {
    const modeVars = readEnvFile(getAIEnvPath(repoRoot, label, env));

    const modeKey = modeVars.OPENROUTER_API_KEY?.trim();
    if (modeKey) keys.set(label, modeKey);

    const modeModel = modeVars.AI_MODEL?.trim();
    if (modeModel) models.set(label, modeModel);
  }

  const settingsVars = readEnvFile(getAISettingsEnvPath(repoRoot, env));
  collectPrefixed(settingsVars, KEY_PREFIX, keys);
  collectPrefixed(settingsVars, MODEL_PREFIX, models);

  return {
    keys: [...keys].map(([label, api_key]) => ({ label, api_key })),
    models: [...models].map(([label, model_id]) => ({ label, model_id })),
  };
}
