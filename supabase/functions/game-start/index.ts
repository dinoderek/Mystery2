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
  getAIProvider,
} from "../_shared/ai-provider.ts";
import { BlueprintSchema } from "../_shared/blueprints/blueprint-schema.ts";
import { createRequestLogger } from "../_shared/logging.ts";
import { NARRATOR_SPEAKER } from "../_shared/speaker.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const logger = createRequestLogger(req, "game-start");
  const { requestId, log, logError } = logger;

  try {
    // Authenticate user
    const authResult = await requireAuth(req);
    if (isAuthError(authResult)) return authResult;
    const { client: supabase, user: authUser } = authResult;

    const body = await req.json();
    if (!body || typeof body.blueprint_id !== "string") {
      log("request.invalid", { reason: "missing_or_invalid_blueprint_id" });
      return badRequest("Missing or invalid blueprint_id");
    }

    const { blueprint_id } = body;

    // Find blueprint in Storage
    const { data: files, error: listError } = await supabase.storage
      .from("blueprints")
      .list();
    if (listError) {
      logError("request.error", { reason: "storage_list_failed" });
      return internalError("Failed to access blueprints");
    }

    let blueprintText: string | null = null;

    for (const file of files || []) {
      if (!file.name.endsWith(".json")) continue;

      const { data: fileData, error: downloadError } = await supabase.storage
        .from("blueprints")
        .download(file.name);
      if (downloadError) continue;

      const text = await fileData.text();
      try {
        const rawJson = JSON.parse(text);
        if (rawJson.id === blueprint_id) {
          blueprintText = text;
          break;
        }
      } catch (e) {
        // ignore invalid JSON
      }
    }

    if (!blueprintText) {
      log("request.invalid", {
        reason: "blueprint_not_found",
        blueprint_id,
      });
      return notFound("Blueprint not found");
    }

    const rawBlueprint = JSON.parse(blueprintText);
    const blueprint = BlueprintSchema.parse(rawBlueprint);
    const startLoc = blueprint.world.starting_location_id;

    // Insert game_session (user_id from authenticated user)
    const { data: sessionData, error: sessionError } = await supabase
      .from("game_sessions")
      .insert({
        user_id: authUser.id,
        blueprint_id: blueprint.id,
        mode: "explore",
        current_location_id: startLoc,
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

    // Generate opening narration
    const aiProvider = getAIProvider();
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

    // Insert start event
    const { error: eventError } = await supabase.from("game_events").insert({
      session_id: sessionId,
      sequence: 1,
      event_type: "start",
      actor: "system",
      payload: {
        speaker: NARRATOR_SPEAKER,
      },
      narration: narration,
    });

    if (eventError) {
      logError("request.error", {
        reason: "event_insert_failed",
        game_id: sessionId,
        error: eventError.message,
      });
      return internalError("Failed to record start event");
    }

    const gameState = {
      locations: blueprint.world.locations.map((l: any) => ({ name: l.name })),
      characters: blueprint.world.characters.map((c: any) => ({
        first_name: c.first_name,
        last_name: c.last_name,
        location_name: c.location,
      })),
      time_remaining: blueprint.metadata.time_budget,
      location: startLoc,
      mode: "explore",
      current_talk_character: null,
      narration: narration,
      narration_speaker: NARRATOR_SPEAKER,
      history: [
        {
          sequence: 1,
          event_type: "start",
          narration,
          speaker: NARRATOR_SPEAKER,
        },
      ],
    };

    return new Response(
      JSON.stringify({
        game_id: sessionId,
        state: gameState,
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
    if (aiResponse) return aiResponse;
    logError("request.unhandled_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return internalError("Internal Server Error");
  }
});
