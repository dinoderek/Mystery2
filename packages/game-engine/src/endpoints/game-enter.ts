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
 * the trace tooling — treats it as the arrival it is. Unlike `game-move` it
 * costs no turn and writes no session state: the player has not gone anywhere.
 */
import type { EngineContext } from "../context.ts";
import {
  asRetriableAIResponse,
  badRequest,
  internalError,
  RetriableAIError,
} from "../errors.ts";
import {
  createAIRequestMetadata,
  createAIProviderFromProfile,
} from "../ai-provider.ts";
import { buildNarrationPrompt } from "../role-request.ts";
import { createRequestLogger, withLogContext } from "../logging.ts";
import {
  createNarrationDiagnostics,
  createNarrationPart,
  insertNarrationEvent,
} from "../narration.ts";
import { NARRATOR_SPEAKER } from "../speaker.ts";

export async function handle(
  req: Request,
  ctx: EngineContext,
): Promise<Response> {
  const logger = createRequestLogger(req, "game-enter");
  const { requestId, log, logError } = logger;

  try {
    const body = await req.json();
    if (!body || !body.game_id) {
      log("request.invalid", { reason: "missing_game_id" });
      return badRequest("Missing game_id");
    }

    const gameId = String(body.game_id);
    const narrationLogger = withLogContext(logger, { game_id: gameId });

    const session = await ctx.sessions.getById(gameId);

    if (!session) {
      log("request.invalid", { reason: "session_not_found", game_id: gameId });
      return badRequest("Game session not found");
    }

    // Only ever valid once, immediately after game-start. Rejecting anything
    // else keeps a double-tap on the confirm prompt from narrating the arrival
    // twice, and is the same condition the client uses to show that prompt.
    const existingEvents = await ctx.events.listBySession(gameId);

    const events = existingEvents ?? [];
    if (events.length !== 1 || events[0].event_type !== "start") {
      log("request.invalid", {
        reason: "already_entered",
        game_id: gameId,
        event_count: events.length,
      });
      return badRequest("Starting location already entered");
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

    const blueprint = await ctx.content.loadBlueprint(session.blueprint_id, narrationLogger);
    if (!blueprint) {
      return internalError("Blueprint missing");
    }

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

    // Public-knowledge summaries only: identity, visible appearance, and the
    // player-facing starting_knowledge summary. Private authored material
    // (background, alibi, motive, ...) never reaches arrival narration.
    const publicSummaryByCharacterId = new Map(
      (blueprint.narrative.starting_knowledge?.characters ?? []).map(
        (entry) => [entry.character_id, entry.summary] as const,
      ),
    );
    const charactersJson = JSON.stringify(
      blueprint.world.characters
        .filter((character) => character.location_id === location.id)
        .map((character) => ({
          id: character.id,
          first_name: character.first_name,
          last_name: character.last_name,
          sex: character.sex,
          appearance: character.appearance,
          public_summary: publicSummaryByCharacterId.get(character.id) ?? null,
        })),
    );

    const subLocations = (location.sub_locations ?? []).map((sl) => ({
      name: sl.name,
    }));

    // Empty history: this is the first thing that happens in the case, so
    // nothing has happened here before. It has to be the empty array rather
    // than omitted — the prompt interpolates the value, and leaving it out put
    // the literal string "undefined" in front of the narrator.
    const aiPrompt = buildNarrationPrompt({
      role: "ambience",
      game_id: gameId,
      blueprint,
      destination_id: location.id,
      has_visited_before: false,
      destination_history_json: "[]",
      destination_characters_json: charactersJson,
      destination_sub_locations_json:
        subLocations.length > 0 ? JSON.stringify(subLocations) : undefined,
    });
    const aiMetadata = createAIRequestMetadata(req, {
      request_id: requestId,
      endpoint: "game-enter",
      action: "enter",
      game_id: gameId,
    });
    const narration = await aiProvider.generateNarration(aiPrompt, aiMetadata);

    const narrationParts = [
      createNarrationPart(
        narration,
        NARRATOR_SPEAKER,
        location.location_image_id ?? null,
      ),
    ];

    await insertNarrationEvent(ctx.events, {
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
    });

    const visible_characters = blueprint.world.characters
      .filter((c) => c.location_id === location.id)
      .map((c) => ({
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        sex: c.sex,
      }));

    return new Response(
      JSON.stringify({
        narration_parts: narrationParts,
        current_location: location.id,
        visible_characters,
        time_remaining: session.time_remaining,
        mode: session.mode,
        current_talk_character: null,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
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
}
