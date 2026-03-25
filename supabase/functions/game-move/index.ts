import { requireAuth, isAuthError } from "../_shared/auth.ts";
import {
  aiRetriableError,
  asRetriableAIResponse,
  badRequest,
  internalError,
  RetriableAIError,
} from "../_shared/errors.ts";
import { validateTransition } from "../_shared/state-machine.ts";
import {
  createAIRequestMetadata,
  createAIProviderFromProfile,
} from "../_shared/ai-provider.ts";
import { getAIProfileById } from "../_shared/ai-profile.ts";
import { buildGameMovePrompt } from "../_shared/ai-prompts.ts";
import { BlueprintV2Schema } from "../_shared/blueprints/blueprint-schema-v2.ts";
import { selectLocationConversationHistory } from "../_shared/ai-context.ts";
import { generateForcedAccusationStartNarration } from "../_shared/forced-endgame.ts";
import { createRequestLogger, withLogContext } from "../_shared/logging.ts";
import {
  createNarrationDiagnostics,
  createNarrationPart,
  insertNarrationEvent,
} from "../_shared/narration.ts";
import { NARRATOR_SPEAKER } from "../_shared/speaker.ts";
import { serveWithCors } from "../_shared/cors.ts";

serveWithCors(async (req) => {
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  const logger = createRequestLogger(req, "game-move");
  const { requestId, log, logError } = logger;

  try {
    const body = await req.json();
    if (!body || !body.game_id || !body.destination) {
      log("request.invalid", { reason: "missing_game_id_or_destination" });
      return badRequest("Missing game_id or destination");
    }

    // Authenticate user
    const authResult = await requireAuth(req);
    if (isAuthError(authResult)) return authResult;
    const { client: userClient } = authResult;

    const { game_id, destination } = body;
    const narrationLogger = withLogContext(logger, { game_id });

    // Fetch session
    const { data: session, error: sessionError } = await userClient
      .from("game_sessions")
      .select("*")
      .eq("id", game_id)
      .single();

    if (sessionError || !session) {
      log("request.invalid", { reason: "session_not_found", game_id: game_id });
      return badRequest("Game session not found");
    }

    validateTransition(session.mode, "move");

    const aiProfile = await getAIProfileById(session.ai_profile_id);
    if (!aiProfile) {
      logError("request.error", {
        reason: "ai_profile_missing",
        game_id: game_id,
        ai_profile_id: session.ai_profile_id ?? null,
      });
      return internalError("AI profile not found");
    }
    const aiProvider = createAIProviderFromProfile(aiProfile, {
      openrouterApiKey: aiProfile.openrouter_api_key,
    });

    // Fetch blueprint
    const { data: fileData, error: downloadError } = await userClient.storage
      .from("blueprints")
      .download(`${session.blueprint_id}.json`);
    if (downloadError) {
      logError("request.error", {
        reason: "blueprint_missing",
        game_id: game_id,
      });
      return internalError("Blueprint missing");
    }
    const blueprintText = await fileData.text();
    const blueprint = BlueprintV2Schema.parse(JSON.parse(blueprintText));

    const destLoc = blueprint.world.locations.find(
      (l) => l.id === destination,
    );
    if (!destLoc) {
      log("request.invalid", {
        reason: "invalid_destination",
        game_id: game_id,
        destination,
      });
      return badRequest("Invalid destination");
    }

    const newTime = Math.max(session.time_remaining - 1, 0);
    const isForcedEndgame = newTime === 0;
    const nextMode = isForcedEndgame ? "accuse" : "explore";

    const { data: historyRows } = await userClient
      .from("game_events")
      .select("sequence,event_type,actor,narration,payload")
      .eq("session_id", game_id)
      .order("sequence", { ascending: true });
    const locationHistory = selectLocationConversationHistory(
      historyRows ?? [],
      destLoc.id,
    );
    const hasVisitedBefore = locationHistory.length > 0;
    const locationHistoryJson = JSON.stringify(locationHistory);
    const destinationCharactersJson = JSON.stringify(
      blueprint.world.characters
        .filter((character) => character.location_id === destLoc.id)
        .map((character) => ({
          id: character.id,
          first_name: character.first_name,
          last_name: character.last_name,
          sex: character.sex,
          appearance: character.appearance,
          background: character.background,
        })),
    );

    const subLocations = (destLoc.sub_locations ?? []).map((sl) => ({
      name: sl.name,
    }));
    const aiPrompt = buildGameMovePrompt({
      target_age: blueprint.metadata.target_age,
      destination_name: destLoc.name,
      destination_description: destLoc.description,
      has_visited_before: hasVisitedBefore,
      destination_history_json: locationHistoryJson,
      destination_characters_json: destinationCharactersJson,
      destination_sub_locations_json:
        subLocations.length > 0 ? JSON.stringify(subLocations) : undefined,
    });
    const aiMetadata = createAIRequestMetadata(req, {
      request_id: requestId,
      endpoint: "game-move",
      action: "move",
      game_id: game_id,
    });
    const narration = await aiProvider.generateNarration(aiPrompt, aiMetadata);
    const moveParts = [
      createNarrationPart(
        narration,
        NARRATOR_SPEAKER,
        destLoc.location_image_id ?? null,
      ),
    ];

    let combinedParts = [...moveParts];
    let followUpPrompt: string | null = null;
    let forcedParts: ReturnType<typeof moveParts.slice> = [];

    if (isForcedEndgame) {
      try {
        const forcedOutput = await generateForcedAccusationStartNarration({
          req,
          request_id: requestId,
          endpoint: "game-move",
          game_id: game_id,
          aiProvider,
          session: {
            ...session,
            current_location_id: destLoc.id,
            time_remaining: newTime,
          },
          blueprint,
          conversation_history: historyRows ?? [],
          scene_summary:
            `The investigator moved to ${destLoc.name}, and that final movement exhausted all remaining time.`,
        });
        followUpPrompt = forcedOutput.follow_up_prompt;
        forcedParts = forcedOutput.narration_parts;
        combinedParts = [...moveParts, ...forcedParts];
      } catch (error) {
        if (error instanceof RetriableAIError) {
          log("request.ai_retriable", {
            game_id: game_id,
            action: "forced_endgame_start",
            code: error.details.code ?? null,
            status: error.details.status ?? null,
            error: error.message,
          });
          return aiRetriableError(error.message, error.details);
        }
        log("request.ai_retriable", {
          game_id: game_id,
          action: "forced_endgame_start",
          code: "AI_INVALID_OUTPUT",
          error: "AI output validation failed",
        });
        return aiRetriableError("AI output validation failed", {
          code: "AI_INVALID_OUTPUT",
        });
      }
    }

    // Update Session
    const { error: updateError } = await userClient
      .from("game_sessions")
      .update({
        current_location_id: destLoc.id,
        time_remaining: newTime,
        mode: nextMode,
        current_talk_character_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", game_id);

    if (updateError) {
      logError("request.error", {
        reason: "session_update_failed",
        game_id: game_id,
      });
      return internalError("Failed to update session");
    }

    const moveSequence = await insertNarrationEvent(userClient, {
      session_id: game_id,
      event_type: "move",
      actor: "system",
      payload: {
        destination: destLoc.id,
        location_id: destLoc.id,
        location_name: destLoc.name,
        location_image_id: destLoc.location_image_id ?? null,
        speaker: NARRATOR_SPEAKER,
      },
      narration_parts: moveParts,
      diagnostics: createNarrationDiagnostics({
        action: "move",
        event_category: "move",
        mode: "explore",
        resulting_mode: nextMode,
        time_before: session.time_remaining,
        time_after: newTime,
        time_consumed: true,
        forced_endgame: isForcedEndgame,
        trigger: "player",
      }),
      logger: narrationLogger,
    });

    let forcedSequence: number | null = null;
    if (isForcedEndgame) {
      forcedSequence = await insertNarrationEvent(userClient, {
        session_id: game_id,
        event_type: "forced_endgame",
        actor: "system",
        payload: {
          trigger: "timeout",
          location_id: destLoc.id,
          location_name: destLoc.name,
          location_image_id: destLoc.location_image_id ?? null,
          follow_up_prompt: followUpPrompt,
          speaker: NARRATOR_SPEAKER,
        },
        narration_parts: forcedParts,
        diagnostics: createNarrationDiagnostics({
          action: "move",
          event_category: "forced_endgame",
          mode: "accuse",
          resulting_mode: "accuse",
          time_before: newTime,
          time_after: newTime,
          time_consumed: false,
          forced_endgame: true,
          trigger: "timeout",
          related_sequence: moveSequence,
        }),
        logger: narrationLogger,
      });

      log("timeout.transition", {
        game_id,
        action: "move",
        time_before: session.time_remaining,
        time_after: newTime,
        resulting_mode: nextMode,
        action_sequence: moveSequence,
        forced_endgame_sequence: forcedSequence,
      });
    }

    const visible_characters = blueprint.world.characters
      .filter((c) => c.location_id === destLoc.id)
      .map((c) => ({
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        sex: c.sex,
      }));

    return new Response(
      JSON.stringify({
        narration_parts: combinedParts,
        current_location: destLoc.id,
        visible_characters,
        time_remaining: newTime,
        mode: nextMode,
        current_talk_character: null,
        follow_up_prompt: followUpPrompt,
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
});
