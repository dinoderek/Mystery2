/**
 * game-enter — step into the starting location.
 *
 * `game-start` only sets the scene: it narrates the premise over the case cover
 * and stops. The player reads that, confirms, and this endpoint generates the
 * arrival narration for the location they are already standing in, so the case
 * opens on a described, pictured place instead of an unseen one.
 *
 * It emits a regular `move` event, so everything downstream — the client's page
 * model, `selectLocationConversationHistory`'s "have I been here before" check,
 * the trace tooling — treats it as the arrival it is. Unlike a move it
 * costs no turn and writes no session state: the player has not gone anywhere.
 */
import { GameEnterRequestSchema } from "../../../shared/src/mystery-api-contracts.ts";
import { AIConfigError } from "../ai-config.ts";
import type { EngineAIProfile, EngineContext } from "../context.ts";
import {
  asConflictResponse,
  asRejectedResponse,
  asRetriableAIResponse,
  badRequest,
  internalError,
  RequestRejectedError,
  RetriableAIError,
} from "../errors.ts";
import {
  createAIRequestMetadata,
  createAIProviderFromProfile,
} from "../ai-provider.ts";
import { buildNarrationPrompt } from "../role-request.ts";
import { createRequestLogger, withLogContext, type LogWriter } from "../logging.ts";
import { readJsonRequest } from "../request.ts";
import {
  createNarrationDiagnostics,
  buildNarrationEvent,
  createNarrationPart,
  logNarrationEventSaved,
} from "../narration.ts";
import { NARRATOR_SPEAKER } from "../speaker.ts";
import { nextSequenceAfter, playedEvents } from "../turn/no-turn.ts";
import { sessionCase } from "../session-case.ts";
import { requestReadingAge } from "../reading-age.ts";
import type { PlayableCase } from "../../../shared/src/playable-case.ts";

/** Who the arrival shows standing at a place. */
function visibleCharacters(blueprint: PlayableCase, locationId: string) {
  return blueprint.world.characters
    .filter((c) => c.location_id === locationId)
    .map((c) => ({
      id: c.id,
      first_name: c.first_name,
      // A clue-graph character goes by one name.
      last_name: "",
      sex: c.sex,
    }));
}

export async function handle(
  req: Request,
  ctx: EngineContext,
): Promise<Response> {
  const logger = createRequestLogger(req, "game-enter");
  const { requestId, log, logError } = logger;

  try {
    const read = await readJsonRequest(req, GameEnterRequestSchema, logger);
    if (!read.ok) return read.response;

    const gameId = read.data.game_id;
    const narrationLogger = withLogContext(logger, { game_id: gameId });

    let session;
    try {
      session = await ctx.sessions.getById(gameId);
    } catch (error) {
      if (!(error instanceof RequestRejectedError)) throw error;
      log("request.invalid", { reason: error.reason, game_id: gameId, error: error.message });
      return asRejectedResponse(error)!;
    }

    if (!session) {
      log("request.invalid", { reason: "session_not_found", game_id: gameId });
      return badRequest("Game session not found");
    }

    // Only ever valid once, immediately after game-start. Rejecting anything
    // else keeps a double-tap on the confirm prompt from narrating the arrival
    // twice, and is the same condition the client uses to show that prompt.
    const existingEvents = await ctx.events.listBySession(gameId);

    const events = existingEvents ?? [];
    const played = playedEvents(events);
    if (played.length !== 1 || played[0].event_type !== "start") {
      log("request.invalid", {
        reason: "already_entered",
        game_id: gameId,
        event_count: events.length,
      });
      return badRequest("Starting location already entered");
    }

    let aiProfile: EngineAIProfile | null;
    try {
      aiProfile = await ctx.aiProfiles.getById(session.ai_profile_id);
    } catch (error) {
      // The AI the game resolves to is missing or broken. Nothing narrates in its place.
      if (!(error instanceof AIConfigError)) throw error;
      logError("request.error", {
        reason: "ai_unavailable",
        game_id: gameId,
        ai_profile_id: session.ai_profile_id,
        error: error.message,
      });
      return internalError(error.message);
    }
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

    const blueprint = await sessionCase(ctx.content, session, narrationLogger);
    if (!blueprint) {
      return internalError("Blueprint missing");
    }
    const readingAge = await requestReadingAge(ctx.profile);

    const location = blueprint.world.locations.find(
      (l) => l.id === session.current_location_id,
    );
    if (!location) {
      logError("request.error", {
        reason: "starting_location_missing",
        game_id: gameId,
        location_id: session.current_location_id ?? null,
      });
      return internalError("Starting location missing from blueprint");
    }

    // Empty history: this is the first thing that happens in the case, so
    // nothing has happened here before and the player holds no clues.
    const aiPrompt = buildNarrationPrompt({
      role: "ambience",
      game_id: gameId,
      blueprint,
      reading_age: readingAge,
      destination_id: location.id,
      conversation_history: [],
    });
    const aiMetadata = createAIRequestMetadata(req, { request_id: requestId, endpoint: "game-enter", action: "enter", game_id: gameId });
    const narration = await aiProvider.generateNarration(aiPrompt, aiMetadata);

    const narrationParts = [
      createNarrationPart(
        narration,
        NARRATOR_SPEAKER,
        location.location_image_id ?? null,
      ),
    ];

    const enterEvent = {
      session_id: gameId,
      event_type: "move",
      actor: "system",
      payload: {
        role: "enter",
        destination: location.id,
        location_id: location.id,
        location_name: location.name,
        location_image_id: location.location_image_id ?? null,
        speaker: NARRATOR_SPEAKER,
      },
      narration_parts: narrationParts,
      model: aiProvider.resolvedModel,
      reading_age: readingAge,
      diagnostics: createNarrationDiagnostics({
        action: "enter",
        event_category: "move",
        mode: session.mode,
        resulting_mode: session.mode,
        time_before: session.time_remaining,
        time_after: session.time_remaining,
        time_consumed: false,
        forced_endgame: false,
        trigger: "player",
      }),
      logger: narrationLogger,
    };

    // The arrival costs no turn, so the session patch is empty; the save still
    // refuses a second arrival that raced this one.
    const sequence = nextSequenceAfter(events);
    await ctx.sessions.saveTurn({
      game_id: gameId,
      expected_sequence: sequence,
      request_id: requestId,
      events: [buildNarrationEvent(enterEvent, sequence)],
    });
    logNarrationEventSaved(enterEvent, sequence);

    return new Response(
      JSON.stringify({
        narration_parts: narrationParts,
        current_location: location.id,
        visible_characters: visibleCharacters(blueprint, location.id),
        time_remaining: session.time_remaining,
        mode: session.mode,
        current_talk_character: null,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return errorResponse(err, logger);
  }
}

/** The answer for a failure the handler did not already answer itself. */
function errorResponse(err: unknown, logger: LogWriter): Response {
  const { log, logError } = logger;
  if (err instanceof RequestRejectedError) {
    log("request.invalid", { reason: err.reason, error: err.message });
    return asRejectedResponse(err)!;
  }
  if (err instanceof RetriableAIError) {
    log("request.ai_retriable", {
      code: err.details.code ?? null,
      status: err.details.status ?? null,
      error: err.message,
    });
    return asRetriableAIResponse(err) ?? internalError("Internal Server Error");
  }
  const aiResponse = asRetriableAIResponse(err);
  if (aiResponse) return aiResponse;
  const conflictResponse = asConflictResponse(err);
  if (conflictResponse) {
    log("request.conflict", { error: String(err) });
    return conflictResponse;
  }
  if (err instanceof Error && err.name === "BadRequestError") {
    log("request.invalid", {
      reason: "bad_request_error",
      message: err.message,
    });
    return badRequest(err.message);
  }
  logError("request.unhandled_error", {
    error: err instanceof Error ? err.message : String(err),
  });
  return internalError("Internal Server Error");
}
