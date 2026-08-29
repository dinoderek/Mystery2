import type { EngineContext } from "../_shared/context.ts";
import { requireEngineContext } from "../_shared/context-supabase.ts";
import {
  aiRetriableError,
  badRequest,
  internalError,
  RetriableAIError,
} from "../_shared/errors.ts";
import { validateTransition } from "../_shared/state-machine.ts";
import {
  createAIRequestMetadata,
  createAIProviderFromProfile,
} from "../_shared/ai-provider.ts";
import { createRequestLogger } from "../_shared/logging.ts";
import { parseTalkEndOutput } from "../_shared/ai-contracts.ts";
import { findCharacterById, findLocationById } from "../_shared/ai-context.ts";
import { buildRoleRequest } from "../_shared/role-request.ts";
import {
  createNarrationDiagnostics,
  createNarrationPart,
  insertNarrationEvent,
} from "../_shared/narration.ts";
import { NARRATOR_SPEAKER } from "../_shared/speaker.ts";
import { serveWithCors } from "../_shared/cors.ts";

export async function handle(
  req: Request,
  ctx: EngineContext,
): Promise<Response> {
  const logger = createRequestLogger(req, "game-end-talk");
  const { requestId, log, logError } = logger;

  try {
    const body = await req.json();
    if (!body || !body.game_id) {
      log("request.invalid", { reason: "missing_game_id" });
      return badRequest("Missing game_id");
    }

    const gameId = String(body.game_id);

    const session = await ctx.sessions.getById(gameId);
    if (!session) {
      log("request.invalid", { reason: "session_not_found", game_id: gameId });
      return badRequest("Game session not found");
    }

    validateTransition(session.mode, "end_talk");
    if (!session.current_talk_character_id) {
      log("request.invalid", { reason: "no_active_talk_character", game_id: gameId });
      return badRequest("No active conversation to end");
    }

    const aiProfile = await ctx.aiProfiles.getById(session.ai_profile_id);
    if (!aiProfile) {
      logError("request.error", {
        reason: "ai_profile_missing",
        game_id: gameId,
        ai_profile_id: session.ai_profile_id ?? null,
      });
      return internalError("AI profile not found");
    }
    const aiProvider = createAIProviderFromProfile(aiProfile, {
      openrouterApiKey: aiProfile.openrouter_api_key,
    });

    const blueprint = await ctx.content.loadBlueprint(session.blueprint_id, logger);
    if (!blueprint) {
      return internalError("Blueprint missing");
    }
    const activeCharacter = findCharacterById(blueprint, session.current_talk_character_id);
    // Ending a conversation puts the player back in the room, so the narration
    // carries the location's picture rather than leaving the portrait up.
    const currentLocation = findLocationById(blueprint, session.current_location_id);

    const historyRows = await ctx.events.listBySession(gameId);

    const { prompt, context: aiContext } = await buildRoleRequest({
      role: "talk_end",
      game_id: gameId,
      session,
      blueprint,
      character_id: session.current_talk_character_id,
      location_id: session.current_location_id,
      conversation_history: historyRows ?? [],
    });
    const aiMetadata = createAIRequestMetadata(req, {
      request_id: requestId,
      endpoint: "game-end-talk",
      action: "end_talk",
      game_id: gameId,
    });

    let talkEndOutput: ReturnType<typeof parseTalkEndOutput>;
    try {
      talkEndOutput = await aiProvider.generateRoleOutput({
        role: "talk_end",
        prompt,
        context: aiContext,
        parse: parseTalkEndOutput,
        metadata: aiMetadata,
      });
    } catch (error) {
      if (error instanceof RetriableAIError) {
        log("request.ai_retriable", {
          game_id: gameId,
          code: error.details.code ?? null,
          status: error.details.status ?? null,
          error: error.message,
        });
        return aiRetriableError(error.message, error.details);
      }
      log("request.ai_retriable", {
        game_id: gameId,
        code: "AI_INVALID_OUTPUT",
        error: "AI output validation failed",
      });
      return aiRetriableError("AI output validation failed", {
        code: "AI_INVALID_OUTPUT",
      });
    }

    try {
      await ctx.sessions.update(gameId, {
        mode: "explore",
        current_talk_character_id: null,
        updated_at: new Date().toISOString(),
      });
    } catch {
      logError("request.error", {
        reason: "session_update_failed",
        game_id: gameId,
      });
      return internalError("Failed to update session");
    }

    const narrationParts = [
      createNarrationPart(
        talkEndOutput.narration,
        NARRATOR_SPEAKER,
        currentLocation?.location_image_id ?? null,
      ),
    ];
    await insertNarrationEvent(ctx.events, {
      session_id: gameId,
      event_type: "end_talk",
      actor: "system",
      payload: {
        role: "talk_end",
        character_id: session.current_talk_character_id,
        character_name: activeCharacter?.first_name ?? session.current_talk_character_id,
        location_id: session.current_location_id,
        location_name: currentLocation?.name ?? session.current_location_id,
        location_image_id: currentLocation?.location_image_id ?? null,
        speaker: NARRATOR_SPEAKER,
      },
      narration_parts: narrationParts,
      model: aiProvider.resolvedModel,
      diagnostics: createNarrationDiagnostics({
        action: "end_talk",
        event_category: "end_talk",
        mode: "talk",
        resulting_mode: "explore",
        time_before: session.time_remaining,
        time_after: session.time_remaining,
        time_consumed: false,
        forced_endgame: false,
        trigger: "player",
      }),
      logger,
    });

    return new Response(
      JSON.stringify({
        narration_parts: narrationParts,
        time_remaining: session.time_remaining,
        mode: "explore",
        current_talk_character: null,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "BadRequestError") {
      log("request.invalid", {
        reason: "bad_request_error",
        message: error.message,
      });
      return badRequest(error.message);
    }
    logError("request.unhandled_error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return internalError("Internal Server Error");
  }
}

serveWithCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const ctx = await requireEngineContext(req);
  if (ctx instanceof Response) return ctx;

  return handle(req, ctx);
});
