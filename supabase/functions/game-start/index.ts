import { DEFAULT_AI_PROFILE_ID, type EngineContext } from "../_shared/context.ts";
import { requireEngineContext } from "../_shared/context-supabase.ts";
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
import { buildNarrationPrompt } from "../_shared/role-request.ts";
import { createRequestLogger } from "../_shared/logging.ts";
import { NARRATOR_SPEAKER } from "../_shared/speaker.ts";
import {
  createNarrationDiagnostics,
  createNarrationPart,
  insertNarrationEvent,
} from "../_shared/narration.ts";
import { serveWithCors } from "../_shared/cors.ts";

// Shown once at the start of every case. The mystery facts, people, places, and
// discovered clues that used to be dumped here now live in the in-game notebook
// (see the `state` payload below), so the opening only needs to point there.
// Written for the youngest player (6): one idea per sentence, everyday words.
// This is the first prose in every case and is not age-parameterised, so it is
// pitched at the bottom of the 6–11 band rather than the middle.
const NOTEBOOK_GUIDANCE =
  'Tip: type "notebook" (or "n") to open your case notebook. ' +
  "It holds what you know, who you have met, and every clue you have found. " +
  'Type "help" to see what else you can do.';

export async function handle(
  req: Request,
  ctx: EngineContext,
): Promise<Response> {
  const logger = createRequestLogger(req, "game-start");
  const { requestId, log, logError } = logger;

  try {
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

    const { blueprint_id } = body;
    const requestedAIProfile = typeof body.ai_profile === "string"
      ? body.ai_profile.trim()
      : null;

    const aiProfile = requestedAIProfile
      ? await ctx.aiProfiles.getById(requestedAIProfile)
      : await ctx.aiProfiles.getById(DEFAULT_AI_PROFILE_ID);

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

    let blueprint;
    try {
      blueprint = await ctx.content.loadBlueprint(blueprint_id, logger);
    } catch {
      logError("request.error", { reason: "storage_list_failed" });
      return internalError("Failed to access blueprints");
    }

    if (!blueprint) {
      log("request.invalid", {
        reason: "blueprint_not_found",
        blueprint_id,
      });
      return notFound("Blueprint not found");
    }

    const startLocId = blueprint.world.starting_location_id;

    // Insert game_session (owned by the authenticated player)
    let sessionId: string;
    try {
      sessionId = await ctx.sessions.create({
        user_id: ctx.player.id,
        blueprint_id: blueprint.id,
        ai_profile_id: aiProfile.id,
        mode: "explore",
        current_location_id: startLocId,
        time_remaining: blueprint.metadata.time_budget,
      });
    } catch (error) {
      logError("request.error", {
        reason: "session_create_failed",
        blueprint_id: blueprint.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return internalError("Failed to create session");
    }

    // Generate opening narration
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
      buildNarrationPrompt({
        role: "intro",
        game_id: sessionId,
        blueprint,
      }),
      aiMetadata,
    );
    const narrationParts = [
      createNarrationPart(
        narration,
        NARRATOR_SPEAKER,
        blueprint.metadata.image_id ?? null,
      ),
      createNarrationPart(NOTEBOOK_GUIDANCE, NARRATOR_SPEAKER),
    ];

    // Insert start event
    try {
      await insertNarrationEvent(ctx.events, {
        session_id: sessionId,
        event_type: "start",
        actor: "system",
        payload: {
          speaker: NARRATOR_SPEAKER,
          blueprint_image_id: blueprint.metadata.image_id ?? null,
          starting_knowledge: blueprint.narrative.starting_knowledge ?? null,
        },
        narration_parts: narrationParts,
        model: aiProvider.resolvedModel,
        diagnostics: createNarrationDiagnostics({
          action: "start",
          event_category: "start",
          mode: "explore",
          resulting_mode: "explore",
          time_before: blueprint.metadata.time_budget,
          time_after: blueprint.metadata.time_budget,
          time_consumed: false,
          forced_endgame: false,
          trigger: "player",
        }),
        logger,
      });
    } catch (eventError) {
      logError("request.error", {
        reason: "event_insert_failed",
        game_id: sessionId,
        error: eventError instanceof Error ? eventError.message : String(eventError),
      });
      return internalError("Failed to record start event");
    }

    const startingKnowledge = blueprint.narrative.starting_knowledge;
    const locationSummaries = new Map(
      (startingKnowledge?.locations ?? []).map((l) => [l.location_id, l.summary]),
    );
    const characterSummaries = new Map(
      (startingKnowledge?.characters ?? []).map((c) => [c.character_id, c.summary]),
    );

    const gameState = {
      mystery_summary: startingKnowledge?.mystery_summary ?? null,
      premise: blueprint.narrative.premise,
      locations: blueprint.world.locations.map((l) => ({
        id: l.id,
        name: l.name,
        summary: locationSummaries.get(l.id) ?? null,
      })),
      characters: blueprint.world.characters.map((c) => ({
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        location_id: c.location_id,
        sex: c.sex,
        summary: characterSummaries.get(c.id) ?? null,
      })),
      discovered_clues: [],
      time_remaining: blueprint.metadata.time_budget,
      location: startLocId,
      mode: "explore",
      current_talk_character: null,
    };

    return new Response(
      JSON.stringify({
        game_id: sessionId,
        state: gameState,
        narration_events: [
          {
            sequence: 1,
            event_type: "start",
            narration_parts: narrationParts,
            payload: {
              speaker: NARRATOR_SPEAKER,
              blueprint_image_id: blueprint.metadata.image_id ?? null,
              starting_knowledge: blueprint.narrative.starting_knowledge ?? null,
              diagnostics: createNarrationDiagnostics({
                action: "start",
                event_category: "start",
                mode: "explore",
                resulting_mode: "explore",
                time_before: blueprint.metadata.time_budget,
                time_after: blueprint.metadata.time_budget,
                time_consumed: false,
                forced_endgame: false,
                trigger: "player",
                related_sequence: 1,
              }),
            },
          },
        ],
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
}

serveWithCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const ctx = await requireEngineContext(req);
  if (ctx instanceof Response) return ctx;

  return handle(req, ctx);
});
