// The AIs this machine can narrate with, and the one resolver that turns an
// AI's name into a backend, a model and a key.
//
// `ai.json` in the config root lists them by name:
//
//   { "ais": { "free": { "backend": "openrouter", "model": "<id>", "key": "..." },
//              "claude": { "backend": "claude-cli", "model": "sonnet" } },
//     "default": "free" }
//
// `mock` is built in and needs no entry. The file is read once, when the server
// starts, and a malformed one stops the start with the AI and field named; a
// missing one only means mock is the sole AI.
//
// A request names an AI, or asks for `default`, which is what the browser always
// plays as. `default` resolves on every request, first that applies:
//
//   1. the run override, `AI_PROFILE`, which `./dev run --ai <name>` sets
//   2. the choice stored by the settings page
//   3. the file's `default`, which covers every database, fresh ones included
//   4. mock
//
// None of them falls back to mock when what it names is missing or broken: that
// is an error naming the AI. A `default` that names no AI in the file is a
// malformed file.

import fs from "node:fs";

import { z } from "zod";

import {
  DEFAULT_AI_PROFILE_ID,
  type AIProfileStore,
  type AISettingsStore,
  type EngineAIProfile,
} from "./context.ts";
import { readEnvFile, type EnvRecord } from "./env-file.ts";
import { resolveAIConfigPath, resolveBaseEnvPath } from "./paths.ts";

export const MOCK_AI_PROFILE_ID = "mock";
const MOCK_MODEL = "mock/runtime-default";

/** The variable that carries the run override from `./dev run --ai` to the server. */
export const RUN_OVERRIDE_ENV = "AI_PROFILE";

const RESERVED_NAMES: readonly string[] = [MOCK_AI_PROFILE_ID, DEFAULT_AI_PROFILE_ID];
/** Names are typed on a command line and sent in requests, so they stay plain. */
const AI_NAME = /^[A-Za-z0-9._-]+$/;

const AIEntrySchema = z
  .object({
    backend: z.enum(["openrouter", "claude-cli"]),
    model: z.string().trim().min(1),
    /** An OpenRouter key, in clear. Without one, the environment's is used. */
    key: z.string().trim().min(1).optional(),
  })
  .strict();

export const AIConfigSchema = z
  .object({
    ais: z.record(z.string(), AIEntrySchema).superRefine((ais, ctx) => {
      for (const name of Object.keys(ais)) {
        if (RESERVED_NAMES.includes(name)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [name],
            message: "is built in and cannot be an entry",
          });
        } else if (!AI_NAME.test(name)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [name],
            message: "has a name with characters other than letters, digits, '.', '_' and '-'",
          });
        }
      }
    }),
    /** The AI `default` resolves to while no run override is set and nothing is chosen. */
    default: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    const name = config.default;
    if (name === undefined || name === MOCK_AI_PROFILE_ID || Object.hasOwn(config.ais, name)) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["default"],
      message: `names AI "${name}", which is not an entry. Name mock or one of the entries`,
    });
  });

export type AIConfig = z.infer<typeof AIConfigSchema>;
export type AIEntry = AIConfig["ais"][string];

/** `ai.json` is malformed, or it cannot give a named AI what it needs. */
export class AIConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIConfigError";
  }
}

/** Where in the file an issue is: the AI, and the field when there is one. */
function issuePlace(path: (string | number)[]): string {
  if (path[0] === "ais" && path.length >= 2) {
    const field = path.slice(2).join(".");
    return field ? `AI "${path[1]}", field "${field}"` : `AI "${path[1]}"`;
  }
  return path.length > 0 ? `field "${path.join(".")}"` : "the file";
}

function issueText(issue: z.ZodIssue): string {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return issue.received === "undefined"
        ? "is missing"
        : `must be ${issue.expected === "object" ? "an object" : `a ${issue.expected}`}, not ${issue.received}`;
    case z.ZodIssueCode.invalid_enum_value:
      return `must be ${issue.options.map((option) => `"${String(option)}"`).join(" or ")}, not "${String(issue.received)}"`;
    case z.ZodIssueCode.unrecognized_keys:
      return `has unknown field${issue.keys.length === 1 ? "" : "s"} ${issue.keys.map((key) => `"${key}"`).join(", ")}`;
    case z.ZodIssueCode.too_small:
      return "is empty";
    default:
      return issue.message;
  }
}

/**
 * Checks a parsed `ai.json`. Every issue is reported, each naming the AI and
 * the field it is about.
 *
 * @throws AIConfigError when the value is not a valid configuration
 */
export function parseAIConfig(value: unknown, source = "ai.json"): AIConfig {
  const result = AIConfigSchema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => `${issuePlace(issue.path)} ${issueText(issue)}`);
  throw new AIConfigError(`${source} is not valid: ${issues.join("; ")}.`);
}

/**
 * Reads `ai.json`. A missing file is an empty configuration, in which mock is
 * the only AI.
 *
 * @throws AIConfigError when the file is not JSON, or not a valid configuration
 */
export function readAIConfig(file: string): AIConfig {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ais: {} };
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new AIConfigError(`${file} is not valid JSON: ${(error as Error).message}`);
  }
  return parseAIConfig(value, file);
}

/** Where an OpenRouter entry without a key of its own finds one. */
export interface AIKeySources {
  /** The process environment. */
  env: EnvRecord;
  /** `.env.local` in the config root, beneath the environment. */
  baseEnv: EnvRecord;
}

export type AIKeySource = "ai.json" | "OPENROUTER_API_KEY" | ".env.local";

/** The key an OpenRouter entry would use, and where it comes from, or null. */
export function findOpenRouterKey(
  entry: AIEntry,
  sources: AIKeySources,
): { key: string; source: AIKeySource } | null {
  if (entry.key) return { key: entry.key, source: "ai.json" };
  const fromEnv = sources.env.OPENROUTER_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: "OPENROUTER_API_KEY" };
  const fromFile = sources.baseEnv.OPENROUTER_API_KEY?.trim();
  if (fromFile) return { key: fromFile, source: ".env.local" };
  return null;
}

function mockProfile(id: string): EngineAIProfile {
  return { id, provider: "mock", model: MOCK_MODEL, openrouter_api_key: null };
}

/**
 * The name `default` resolves to right now: the run override, the stored
 * choice, the file's default, then mock.
 */
export function defaultAIName(loaded: LoadedAIConfig, settings?: AISettingsStore): string {
  return (
    loaded.runOverride?.name ?? settings?.getChoice() ?? loaded.config.default ?? MOCK_AI_PROFILE_ID
  );
}

/** The names a request may use: mock, then the file's. */
export function availableAINames(config: AIConfig): string[] {
  return [MOCK_AI_PROFILE_ID, ...Object.keys(config.ais)];
}

/**
 * Resolves one AI by name: `mock`, or an entry of the file. Returns null for a
 * name that is neither, which `game-start` answers with `400 Invalid
 * ai_profile`. `default` is not a name here; `resolveAIProfile` handles it.
 *
 * @throws AIConfigError for an OpenRouter entry with no key anywhere
 */
export function resolveNamedAI(
  name: string,
  config: AIConfig,
  sources: AIKeySources,
): EngineAIProfile | null {
  if (name === MOCK_AI_PROFILE_ID) return mockProfile(MOCK_AI_PROFILE_ID);
  if (!Object.hasOwn(config.ais, name)) return null;

  const entry = config.ais[name];
  // The claude CLI brings the machine's own Claude Code login.
  if (entry.backend === "claude-cli") {
    return { id: name, provider: "claude-cli", model: entry.model, openrouter_api_key: null };
  }

  const found = findOpenRouterKey(entry, sources);
  if (!found) {
    throw new AIConfigError(
      `AI "${name}" uses openrouter but has no key: give its entry in ai.json a "key", ` +
        "or set OPENROUTER_API_KEY in the environment or in .env.local.",
    );
  }
  return { id: name, provider: "openrouter", model: entry.model, openrouter_api_key: found.key };
}

/** The AI a run was started with, which `default` resolves to while it is set. */
export interface RunOverride {
  name: string;
  profile: EngineAIProfile;
}

/**
 * The run override, or null when `AI_PROFILE` is unset or empty.
 *
 * The resolver and the settings page's banner both read the result of this one
 * function, so the banner cannot say one thing while narration does another.
 *
 * @throws AIConfigError when it names an AI that is missing or cannot work
 */
export function readRunOverride(config: AIConfig, sources: AIKeySources): RunOverride | null {
  const name = sources.env[RUN_OVERRIDE_ENV]?.trim();
  if (!name) return null;

  const known = availableAINames(config).join(", ");
  if (name === DEFAULT_AI_PROFILE_ID) {
    throw new AIConfigError(`${RUN_OVERRIDE_ENV}=default names no AI. Name one of: ${known}.`);
  }
  const profile = resolveNamedAI(name, config, sources);
  if (!profile) {
    throw new AIConfigError(
      `${RUN_OVERRIDE_ENV} names AI "${name}", which is not in ai.json. Name one of: ${known}.`,
    );
  }
  return { name, profile };
}

/** Everything resolution needs, read from the config root once. */
export interface LoadedAIConfig {
  /** The `ai.json` path, whether or not it exists. */
  file: string;
  config: AIConfig;
  sources: AIKeySources;
  runOverride: RunOverride | null;
}

export interface LoadAIConfigOptions {
  repoRoot?: string;
  env?: EnvRecord;
}

/**
 * Reads `ai.json`, `.env.local` and the run override from the config root.
 *
 * @throws AIConfigError when the file is malformed or the run override cannot
 * be resolved; both stop a server from starting
 */
export function loadAIConfig(options: LoadAIConfigOptions = {}): LoadedAIConfig {
  const repoRoot = options.repoRoot ?? process.cwd();
  const env = options.env ?? process.env;

  const file = resolveAIConfigPath(repoRoot, env);
  const config = readAIConfig(file);
  const sources: AIKeySources = { env, baseEnv: readEnvFile(resolveBaseEnvPath(repoRoot, env)) };
  return { file, config, sources, runOverride: readRunOverride(config, sources) };
}

/**
 * Resolves the AI chosen on the settings page.
 *
 * @throws AIConfigError when the name is no longer in `ai.json`, or names an
 * AI that cannot work: a chosen AI that has gone is an error, never mock
 */
export function resolveChosenAI(name: string, loaded: LoadedAIConfig): EngineAIProfile {
  const profile = resolveNamedAI(name, loaded.config, loaded.sources);
  if (profile) return profile;
  throw new AIConfigError(
    `The AI chosen on the settings page, "${name}", is not in ai.json. ` +
      "Choose another there, or add it back to ai.json and restart.",
  );
}

/**
 * Resolves the file's `default`, which parsing has checked names mock or an
 * entry.
 *
 * @throws AIConfigError for a default that cannot work, naming it
 */
export function resolveConfiguredDefault(name: string, loaded: LoadedAIConfig): EngineAIProfile {
  try {
    return resolveNamedAI(name, loaded.config, loaded.sources)!;
  } catch (error) {
    if (!(error instanceof AIConfigError)) throw error;
    throw new AIConfigError(`The default in ${loaded.file}, "${name}", cannot narrate. ${error.message}`);
  }
}

/**
 * Resolves the profile a request or a stored game names. Returns null for a
 * name that is not configured here.
 *
 * @throws AIConfigError for a named OpenRouter AI with no key, and for a
 * `default` whose stored choice or configured default is missing or broken
 */
export function resolveAIProfile(
  profileId: string,
  loaded: LoadedAIConfig,
  settings?: AISettingsStore,
): EngineAIProfile | null {
  const id = profileId.trim();
  if (!id) return null;
  if (id !== DEFAULT_AI_PROFILE_ID) return resolveNamedAI(id, loaded.config, loaded.sources);

  if (loaded.runOverride) return { ...loaded.runOverride.profile, id: DEFAULT_AI_PROFILE_ID };

  const chosen = settings?.getChoice() ?? null;
  if (chosen !== null) return { ...resolveChosenAI(chosen, loaded), id: DEFAULT_AI_PROFILE_ID };
  const configured = loaded.config.default;
  if (configured !== undefined) {
    return { ...resolveConfiguredDefault(configured, loaded), id: DEFAULT_AI_PROFILE_ID };
  }
  return mockProfile(DEFAULT_AI_PROFILE_ID);
}

export function createLocalAIProfileStore(
  loaded: LoadedAIConfig,
  settings?: AISettingsStore,
): AIProfileStore {
  return {
    async getById(profileId: string): Promise<EngineAIProfile | null> {
      return resolveAIProfile(profileId, loaded, settings);
    },
  };
}
