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
import { BlueprintSchema } from "../_shared/blueprints/blueprint-schema.ts";
import { selectLocationConversationHistory } from "../_shared/ai-context.ts";
import { generateForcedAccusationStartNarration } from "../_shared/forced-endgame.ts";
import { createRequestLogger } from "../_shared/logging.ts";
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

    // Fetch blueprint locations
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
    const blueprint = BlueprintSchema.parse(JSON.parse(blueprintText));

    const destLoc = blueprint.world.locations.find(
      (l) => l.name === destination,
    );
    if (!destLoc) {
      log("request.invalid", {
        reason: "invalid_destination",
        game_id: game_id,
        destination,
      });
      return badRequest("Invalid destination");
    }

    let newTime = session.time_remaining - 1;
    let nextMode = session.mode;
    let eventType = "move";

    const { data: historyRows } = await userClient
      .from("game_events")
      .select("sequence,event_type,actor,narration,payload")
      .eq("session_id", game_id)
      .order("sequence", { ascending: true });
    const locationHistory = selectLocationConversationHistory(
      historyRows ?? [],
      destLoc.name,
    );
    const locationHistoryJson = JSON.stringify(locationHistory);

    let narration: string;

    if (newTime <= 0) {
      nextMode = "accuse";
      eventType = "forced_endgame";
      try {
        const forcedOutput = await generateForcedAccusationStartNarration({
          req,
          request_id: requestId,
          endpoint: "game-move",
          game_id: game_id,
          aiProvider,
          session: {
            ...session,
            current_location_id: destLoc.name,
          },
          blueprint,
          conversation_history: historyRows ?? [],
          scene_summary:
            `The investigator moved to ${destLoc.name}, and that final movement exhausted all remaining time.`,
        });
        narration = forcedOutput.narration;
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
    } else {
      const aiPrompt =
        `The player moves to ${destLoc.name}. Describe the new location concisely based on: ${destLoc.description}. Use all and only the interaction history tied to ${destLoc.name}: ${locationHistoryJson}.`;
      const aiMetadata = createAIRequestMetadata(req, {
        request_id: requestId,
        endpoint: "game-move",
        action: "move",
        game_id: game_id,
      });
      narration = await aiProvider.generateNarration(aiPrompt, aiMetadata);
    }

    // Update Session
    const { error: updateError } = await userClient
      .from("game_sessions")
      .update({
        current_location_id: destLoc.name,
        time_remaining: newTime,
        mode: nextMode,
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

    // Record Event
    const { data: events } = await userClient
      .from("game_events")
      .select("sequence")
      .eq("session_id", game_id)
      .order("sequence", { ascending: false })
      .limit(1);
    const nextSeq = events && events.length > 0 ? events[0].sequence + 1 : 1;
    const eventPayload: Record<string, unknown> = {
      destination,
      location_name: destLoc.name,
      location_image_id: destLoc.location_image_id ?? null,
      speaker: NARRATOR_SPEAKER,
    };
    if (eventType === "forced_endgame") {
      eventPayload.trigger = "timeout";
    }

    await userClient.from("game_events").insert({
      session_id: game_id,
      sequence: nextSeq,
      event_type: eventType,
      actor: "system",
      payload: eventPayload,
      narration: narration,
    });

    const visible_characters = blueprint.world.characters
      .filter((c) => c.location === destLoc.name)
      .map((c) => ({ first_name: c.first_name, last_name: c.last_name }));

    return new Response(
      JSON.stringify({
        narration: narration,
        current_location: destLoc.name,
        visible_characters,
        time_remaining: newTime,
        mode: nextMode,
        location_image_id: destLoc.location_image_id ?? null,
        speaker: NARRATOR_SPEAKER,
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
