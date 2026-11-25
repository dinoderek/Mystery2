// What the settings page shows, and the one rule for what it may choose.
//
// The page lists mock and the AIs in `ai.json`, marks the stored choice, names
// a run override while one is in force, and says which AI narrates a game
// started now. It never carries a key: nothing here copies one into a summary.

import {
  AISettingsUpdateSchema,
  type AIChoice,
  type AISettingsState,
  type AISummary,
} from "../../shared/src/mystery-api-contracts.ts";
import {
  AIConfigError,
  availableAINames,
  MOCK_AI_PROFILE_ID,
  resolveAIProfile,
  resolveNamedAI,
  type LoadedAIConfig,
} from "./ai-config.ts";
import { DEFAULT_AI_PROFILE_ID, type AISettingsStore, type EngineAIProfile } from "./context.ts";
import { badRequest } from "./errors.ts";
import { createRequestLogger } from "./logging.ts";
import { readJsonRequest } from "./request.ts";

/** The page asked for something it cannot choose. Answered with `400`. */
export class AIChoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIChoiceError";
  }
}

function summary(name: string, profile: EngineAIProfile): AISummary {
  return { name, backend: profile.provider, model: profile.model };
}

/** One AI as listed: what it is, and what it lacks, if anything. */
function describeAI(name: string, loaded: LoadedAIConfig): AIChoice {
  try {
    // Every listed name resolves: it is mock or an entry of the file.
    return { ...summary(name, resolveNamedAI(name, loaded.config, loaded.sources)!), problem: null };
  } catch (error) {
    if (!(error instanceof AIConfigError)) throw error;
    const entry = loaded.config.ais[name];
    return { name, backend: entry.backend, model: entry.model, problem: error.message };
  }
}

/** The narrator `default` resolves to right now, or why there is none. */
function describeNarrator(
  loaded: LoadedAIConfig,
  settings: AISettingsStore,
): Pick<AISettingsState, "narrator" | "narrator_error"> {
  try {
    const profile = resolveAIProfile(DEFAULT_AI_PROFILE_ID, loaded, settings)!;
    const name = loaded.runOverride?.name ?? settings.getChoice() ?? MOCK_AI_PROFILE_ID;
    return { narrator: summary(name, profile), narrator_error: null };
  } catch (error) {
    if (!(error instanceof AIConfigError)) throw error;
    return { narrator: null, narrator_error: error.message };
  }
}

/** Everything the settings page and the profile picker show. */
export function describeAISettings(loaded: LoadedAIConfig, settings: AISettingsStore): AISettingsState {
  const override = loaded.runOverride;
  return {
    ais: availableAINames(loaded.config).map((name) => describeAI(name, loaded)),
    chosen: settings.getChoice(),
    override: override ? summary(override.name, override.profile) : null,
    ...describeNarrator(loaded, settings),
  };
}

/**
 * Stores `name` as the choice: mock, or an AI in the file that has what it
 * needs. A choice that could not narrate is refused here rather than stored to
 * fail on the next game.
 *
 * @throws AIChoiceError for a name that is not listed, or an AI that lacks
 * what it needs
 */
export function chooseAI(loaded: LoadedAIConfig, settings: AISettingsStore, name: string): void {
  const names = availableAINames(loaded.config);
  if (!names.includes(name)) {
    throw new AIChoiceError(`There is no AI named "${name}" in ai.json. Choose one of: ${names.join(", ")}.`);
  }
  const { problem } = describeAI(name, loaded);
  if (problem) throw new AIChoiceError(problem);
  settings.setChoice(name);
}

/**
 * `POST /api/ai-settings`: reads `{ name }`, stores it as the choice, and
 * answers with the state the page shows. A name that cannot be chosen answers
 * `400` saying why.
 */
export async function handleAIChoice(
  req: Request,
  loaded: LoadedAIConfig,
  settings: AISettingsStore,
): Promise<Response> {
  const logger = createRequestLogger(req, "ai-settings");
  const read = await readJsonRequest(req, AISettingsUpdateSchema, logger);
  if (!read.ok) return read.response;

  try {
    chooseAI(loaded, settings, read.data.name);
  } catch (error) {
    if (!(error instanceof AIChoiceError)) throw error;
    logger.log("request.invalid", { reason: "ai_not_choosable", ai_name: read.data.name, error: error.message });
    return badRequest(error.message);
  }
  logger.log("ai_settings.chosen", { ai_name: read.data.name });
  return Response.json(describeAISettings(loaded, settings));
}
