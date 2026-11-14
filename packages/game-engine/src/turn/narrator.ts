// The turn's calls to the narrator. Each call says which action it served;
// a role's failure reaches the player as the retriable 503 it always has been.

import { parseAccusationStartOutput } from "../ai-contracts.ts";
import {
  createAIRequestMetadata,
  type AIRequestMetadata,
  type AIRoleOutputRequest,
} from "../ai-provider.ts";
import { RetriableAIError } from "../errors.ts";
import { buildRoleRequest } from "../role-request.ts";
import { createNarrationPart } from "../narration.ts";
import { NARRATOR_SPEAKER } from "../speaker.ts";
import type { EndgameScene, ForcedEndgame, TurnGame, TurnRuntime } from "./types.ts";

/** The endpoint every turn's AI calls are recorded under; `action` says which. */
export const TURN_ENDPOINT = "game-turn";

function metadataFor(runtime: TurnRuntime, action: string): AIRequestMetadata {
  return createAIRequestMetadata(runtime.req, {
    request_id: runtime.request_id,
    endpoint: TURN_ENDPOINT,
    action,
    game_id: runtime.game_id,
  });
}

function logRetriable(runtime: TurnRuntime, action: string, error: RetriableAIError): void {
  runtime.logger.log("request.ai_retriable", {
    game_id: runtime.game_id,
    action,
    code: error.details.code ?? null,
    status: error.details.status ?? null,
    error: error.message,
  });
}

/** Free narration, as an arrival uses. A failure is passed on as it came. */
export async function narrate(runtime: TurnRuntime, action: string, prompt: string): Promise<string> {
  try {
    return await runtime.provider.generateNarration(prompt, metadataFor(runtime, action));
  } catch (error) {
    if (error instanceof RetriableAIError) logRetriable(runtime, action, error);
    throw error;
  }
}

/**
 * One role's structured output. A retriable failure is passed on; any other
 * failure, an output that did not parse included, becomes a retriable
 * `AI_INVALID_OUTPUT`.
 */
export async function askRole<T>(
  runtime: TurnRuntime,
  action: string,
  request: Omit<AIRoleOutputRequest<T>, "metadata">,
): Promise<T> {
  try {
    return await runtime.provider.generateRoleOutput({ ...request, metadata: metadataFor(runtime, action) });
  } catch (error) {
    if (error instanceof RetriableAIError) {
      logRetriable(runtime, action, error);
      throw error;
    }
    return rejectOutput(runtime, action, "AI output validation failed");
  }
}

/** Refuses a narrator answer the turn cannot use, as a retriable failure. */
export function rejectOutput(runtime: TurnRuntime, action: string, reason: string): never {
  runtime.logger.log("request.ai_retriable", {
    game_id: runtime.game_id,
    action,
    code: "AI_INVALID_OUTPUT",
    error: reason,
  });
  throw new RetriableAIError("AI output validation failed", { code: "AI_INVALID_OUTPUT" });
}

/** The accusation scene the narrator sets when the last turn has been spent. */
export async function narrateForcedEndgame(
  runtime: TurnRuntime,
  game: TurnGame,
  scene: EndgameScene,
  timeAfter: number,
): Promise<ForcedEndgame> {
  const { prompt, context } = await buildRoleRequest({
    role: "accusation_start",
    game_id: game.game_id,
    session: {
      ...game.session,
      current_location_id: scene.location_id ?? game.session.current_location_id,
      time_remaining: timeAfter,
      mode: "accuse",
      current_talk_character_id: null,
    },
    blueprint: game.blueprint,
    forced_by_timeout: true,
    forced_context: scene.scene_summary,
    conversation_history: game.history,
  });
  const output = await askRole(runtime, "forced_endgame_start", {
    role: "accusation_start",
    prompt,
    context,
    parse: parseAccusationStartOutput,
  });
  return {
    narration_parts: [createNarrationPart(output.narration, NARRATOR_SPEAKER)],
    // Read straight after the call: it names the model that set this scene.
    model: runtime.provider.resolvedModel,
  };
}
