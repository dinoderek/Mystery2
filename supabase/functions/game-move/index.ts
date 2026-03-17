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
import {
  createBlueprintRuntime,
  findLocationByName,
  getEvidenceSummary,
  listVisibleCharacters,
  loadBlueprintFromStorage,
  UnsupportedSessionStateError,
} from "../_shared/blueprints/runtime.ts";
import { selectLocationConversationHistory } from "../_shared/ai-context.ts";
import { generateForcedAccusationStartNarration } from "../_shared/forced-endgame.ts";
import { createRequestLogger } from "../_shared/logging.ts";
import { NARRATOR_SPEAKER } from "../_shared/speaker.ts";
import { serveWithCors } from "../_shared/cors.ts";

serveWithCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const logger = createRequestLogger(req, "game-move");
  const { requestId, log, logError } = logger;

  try {
    const body = await req.json();
    if (!body || !body.game_id || !body.destination) {
      log("request.invalid", { reason: "missing_game_id_or_destination" });
      return badRequest("Missing game_id or destination");
    }

    const authResult = await requireAuth(req);
    if (isAuthError(authResult)) {
      return authResult;
    }
    const { client: userClient } = authResult;

    const gameId = String(body.game_id);
    const destination = String(body.destination);

    const { data: session, error: sessionError } = await userClient
      .from("game_sessions")
      .select("*")
      .eq("id", gameId)
      .single();

    if (sessionError || !session) {
      log("request.invalid", { reason: "session_not_found", game_id: gameId });
      return badRequest("Game session not found");
    }

    validateTransition(session.mode, "move");

    const aiProfile = await getAIProfileById(session.ai_profile_id);
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

    const blueprint = await loadBlueprintFromStorage(userClient, session.blueprint_id);
    if (!blueprint) {
      logError("request.error", { reason: "blueprint_missing", game_id: gameId });
      return internalError("Blueprint missing");
    }
    const runtime = createBlueprintRuntime(blueprint);
    const destinationLocation = findLocationByName(blueprint, destination);
    if (!destinationLocation) {
      log("request.invalid", {
        reason: "invalid_destination",
        game_id: gameId,
        destination,
      });
      return badRequest("Invalid destination");
    }

    const { data: historyRows } = await userClient
      .from("game_events")
      .select("sequence,event_type,actor,narration,payload")
      .eq("session_id", gameId)
      .order("sequence", { ascending: true });
    const locationHistory = selectLocationConversationHistory(
      historyRows ?? [],
      destinationLocation.name,
      destinationLocation.location_key,
    );

    const newTime = session.time_remaining - 1;
    const isForcedEndgame = newTime <= 0;
    const nextMode = isForcedEndgame ? "accuse" : "explore";
    const eventType = isForcedEndgame ? "forced_endgame" : "move";
    const moveEvidence = getEvidenceSummary(blueprint, "move", {
      location_key: destinationLocation.location_key,
    });
    let narration: string;

    if (isForcedEndgame) {
      try {
        const forcedOutput = await generateForcedAccusationStartNarration({
          req,
          request_id: requestId,
          endpoint: "game-move",
          game_id: gameId,
          aiProvider,
          session: {
            ...session,
            current_location_id: destinationLocation.location_key,
          },
          blueprint,
          conversation_history: historyRows ?? [],
          scene_summary:
            `The investigator moved to ${destinationLocation.name}, and that final move used the last remaining turn.`,
        });
        narration = forcedOutput.narration;
      } catch (error) {
        if (error instanceof RetriableAIError) {
          return aiRetriableError(error.message, error.details);
        }
        return aiRetriableError("AI output validation failed", {
          code: "AI_INVALID_OUTPUT",
        });
      }
    } else {
      const aiMetadata = createAIRequestMetadata(req, {
        request_id: requestId,
        endpoint: "game-move",
        action: "move",
        game_id: gameId,
      });
      narration = await aiProvider.generateNarration(
        `The player moves to ${destinationLocation.name}. Describe the location based on: ${destinationLocation.description}. Use only the previous move/search history tied to this location: ${JSON.stringify(locationHistory)}.`,
        aiMetadata,
      );
    }

    const { error: updateError } = await userClient
      .from("game_sessions")
      .update({
        current_location_id: destinationLocation.location_key,
        current_talk_character_id: null,
        time_remaining: newTime,
        mode: nextMode,
        updated_at: new Date().toISOString(),
      })
      .eq("id", gameId);
    if (updateError) {
      return internalError("Failed to update session");
    }

    const { data: lastEvents } = await userClient
      .from("game_events")
      .select("sequence")
      .eq("session_id", gameId)
      .order("sequence", { ascending: false })
      .limit(1);
    const nextSequence = lastEvents && lastEvents.length > 0
      ? lastEvents[0].sequence + 1
      : 1;

    await userClient.from("game_events").insert({
      session_id: gameId,
      sequence: nextSequence,
      event_type: eventType,
      actor: "system",
      payload: {
        destination,
        destination_key: destinationLocation.location_key,
        location_key: destinationLocation.location_key,
        location_name: destinationLocation.name,
        location_image_id: destinationLocation.location_image_id ?? null,
        move_evidence: moveEvidence,
        ...(isForcedEndgame ? { trigger: "timeout" } : {}),
        speaker: NARRATOR_SPEAKER,
      },
      narration,
      narration_parts: [narration],
    });

    return new Response(
      JSON.stringify({
        narration,
        current_location: destinationLocation.name,
        visible_characters: listVisibleCharacters(
          runtime,
          destinationLocation.location_key,
        ),
        time_remaining: newTime,
        mode: nextMode,
        location_image_id: destinationLocation.location_image_id ?? null,
        speaker: NARRATOR_SPEAKER,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    if (error instanceof UnsupportedSessionStateError) {
      return badRequest("Session state is incompatible with Blueprint V2");
    }
    if (error instanceof RetriableAIError) {
      return asRetriableAIResponse(error) ??
        internalError("Internal Server Error");
    }
    const aiResponse = asRetriableAIResponse(error);
    if (aiResponse) {
      return aiResponse;
    }
    if (error instanceof Error && error.name === "BadRequestError") {
      return badRequest(error.message);
    }
    logError("request.unhandled_error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return internalError("Internal Server Error");
  }
});
