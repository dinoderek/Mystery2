import { requireAuth, isAuthError } from "../_shared/auth.ts";
import {
  asRetriableAIResponse,
  badRequest,
  internalError,
  notFound,
  RetriableAIError,
} from "../_shared/errors.ts";
import {
  createAIRequestMetadata,
  createAIProviderFromProfile,
} from "../_shared/ai-provider.ts";
import {
  getAIProfileById,
  getDefaultAIProfile,
} from "../_shared/ai-profile.ts";
import {
  buildPublicWorld,
  createBlueprintRuntime,
  getEvidenceSummary,
  loadBlueprintFromStorage,
  requireLocation,
} from "../_shared/blueprints/runtime.ts";
import { createRequestLogger } from "../_shared/logging.ts";
import { NARRATOR_SPEAKER } from "../_shared/speaker.ts";
import { serveWithCors } from "../_shared/cors.ts";

serveWithCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const logger = createRequestLogger(req, "game-start");
  const { requestId, log, logError } = logger;

  try {
    const authResult = await requireAuth(req);
    if (isAuthError(authResult)) {
      return authResult;
    }
    const { client: supabase, user: authUser } = authResult;

    const body = await req.json();
    if (!body || typeof body.blueprint_id !== "string") {
      log("request.invalid", { reason: "missing_or_invalid_blueprint_id" });
      return badRequest("Missing or invalid blueprint_id");
    }
    if (
      body.ai_profile !== undefined &&
      (typeof body.ai_profile !== "string" || body.ai_profile.trim().length === 0)
    ) {
      log("request.invalid", { reason: "invalid_ai_profile" });
      return badRequest("Invalid ai_profile");
    }

    const blueprintId = body.blueprint_id;
    const requestedAIProfile = typeof body.ai_profile === "string"
      ? body.ai_profile.trim()
      : null;

    const aiProfile = requestedAIProfile
      ? await getAIProfileById(requestedAIProfile)
      : await getDefaultAIProfile();

    if (requestedAIProfile && !aiProfile) {
      log("request.invalid", {
        reason: "unknown_ai_profile",
        ai_profile: requestedAIProfile,
      });
      return badRequest("Invalid ai_profile");
    }
    if (!aiProfile) {
      logError("request.error", { reason: "default_ai_profile_missing" });
      return internalError("No default AI profile configured");
    }

    const blueprint = await loadBlueprintFromStorage(supabase, blueprintId);
    if (!blueprint) {
      log("request.invalid", {
        reason: "blueprint_not_found",
        blueprint_id: blueprintId,
      });
      return notFound("Blueprint not found");
    }

    const runtime = createBlueprintRuntime(blueprint);
    const startingLocation = requireLocation(
      runtime,
      blueprint.world.starting_location_key,
    );

    const { data: sessionData, error: sessionError } = await supabase
      .from("game_sessions")
      .insert({
        user_id: authUser.id,
        blueprint_id: blueprint.id,
        ai_profile_id: aiProfile.id,
        mode: "explore",
        current_location_id: blueprint.world.starting_location_key,
        time_remaining: blueprint.metadata.time_budget,
      })
      .select("id")
      .single();

    if (sessionError) {
      logError("request.error", {
        reason: "session_create_failed",
        blueprint_id: blueprint.id,
        error: sessionError.message,
      });
      return internalError("Failed to create session");
    }

    const sessionId = sessionData.id;
    const aiProvider = createAIProviderFromProfile(aiProfile, {
      openrouterApiKey: aiProfile.openrouter_api_key,
    });
    const aiMetadata = createAIRequestMetadata(req, {
      request_id: requestId,
      endpoint: "game-start",
      action: "start",
      game_id: sessionId,
    });
    const narration = await aiProvider.generateNarration(
      blueprint.narrative.premise,
      aiMetadata,
    );

    const { error: eventError } = await supabase.from("game_events").insert({
      session_id: sessionId,
      sequence: 1,
      event_type: "start",
      actor: "system",
      payload: {
        location_key: startingLocation.location_key,
        location_name: startingLocation.name,
        evidence: getEvidenceSummary(blueprint, "start", {
          location_key: startingLocation.location_key,
        }),
        speaker: NARRATOR_SPEAKER,
      },
      narration,
      narration_parts: [narration],
    });

    if (eventError) {
      logError("request.error", {
        reason: "event_insert_failed",
        game_id: sessionId,
        error: eventError.message,
      });
      return internalError("Failed to record start event");
    }

    const publicWorld = buildPublicWorld(runtime);

    return new Response(
      JSON.stringify({
        game_id: sessionId,
        state: {
          locations: publicWorld.locations,
          characters: publicWorld.characters,
          time_remaining: blueprint.metadata.time_budget,
          location: startingLocation.name,
          mode: "explore",
          current_talk_character: null,
          narration,
          narration_speaker: NARRATOR_SPEAKER,
          history: [
            {
              sequence: 1,
              event_type: "start",
              narration,
              speaker: NARRATOR_SPEAKER,
            },
          ],
        },
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
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
    if (aiResponse) {
      return aiResponse;
    }
    logError("request.unhandled_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return internalError("Internal Server Error");
  }
});
