import { GameStartRequestSchema } from "../../../shared/src/mystery-api-contracts.ts";
import type { BlueprintV2 } from "../../../shared/src/blueprint-schema-v2.ts";
import {
  DEFAULT_AI_PROFILE_ID,
  type EngineAIProfile,
  type EngineContext,
} from "../context.ts";
import {
  asRetriableAIResponse,
  badRequest,
  internalError,
  notFound,
  RetriableAIError,
} from "../errors.ts";
import {
  createAIRequestMetadata,
  createAIProviderFromProfile,
} from "../ai-provider.ts";
import { buildGameState } from "../game-state-view.ts";
import { buildNarrationPrompt } from "../role-request.ts";
import { createRequestLogger, type LogWriter } from "../logging.ts";
import { readJsonRequest } from "../request.ts";
import { NARRATOR_SPEAKER } from "../speaker.ts";
import {
  createNarrationDiagnostics,
  buildNarrationEvent,
  createNarrationPart,
  logNarrationEventSaved,
} from "../narration.ts";

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

const JSON_HEADERS = { "Content-Type": "application/json" };

type ProfileResult =
  | { profile: EngineAIProfile; response?: undefined }
  | { profile?: undefined; response: Response };

/** The profile the request named, or the default, or the response that refuses it. */
async function resolveProfile(
  ctx: EngineContext,
  requested: string | undefined,
  logger: LogWriter,
): Promise<ProfileResult> {
  const profile = await ctx.aiProfiles.getById(requested ?? DEFAULT_AI_PROFILE_ID);
  if (profile) return { profile };

  if (requested) {
    logger.log("request.invalid", { reason: "unknown_ai_profile", ai_profile: requested });
    return { response: badRequest("Invalid ai_profile") };
  }
  logger.logError("request.error", { reason: "default_ai_profile_missing" });
  return { response: internalError("No default AI profile configured") };
}

/** The opening diagnostics; the response carries them with the sequence they relate to. */
function startDiagnostics(blueprint: BlueprintV2, relatedSequence?: number) {
  return createNarrationDiagnostics({
    action: "start",
    event_category: "start",
    mode: "explore",
    resulting_mode: "explore",
    time_before: blueprint.metadata.time_budget,
    time_after: blueprint.metadata.time_budget,
    time_consumed: false,
    forced_endgame: false,
    trigger: "player",
    ...(relatedSequence === undefined ? {} : { related_sequence: relatedSequence }),
  });
}

function startPayload(blueprint: BlueprintV2) {
  return {
    speaker: NARRATOR_SPEAKER,
    blueprint_image_id: blueprint.metadata.image_id ?? null,
    starting_knowledge: blueprint.narrative.starting_knowledge ?? null,
  };
}

/** Narrates the opening and saves the session with its first event, in one write. */
async function openCase(
  req: Request,
  ctx: EngineContext,
  logger: ReturnType<typeof createRequestLogger>,
  blueprint: BlueprintV2,
  profile: EngineAIProfile,
) {
  // The id exists before the session does: nothing is written until the
  // narration has, so a failed model call leaves no game behind.
  const gameId = crypto.randomUUID();

  const provider = createAIProviderFromProfile(profile, {
    openrouterApiKey: profile.openrouter_api_key,
  });
  const narration = await provider.generateNarration(
    buildNarrationPrompt({ role: "intro", game_id: gameId, blueprint }),
    createAIRequestMetadata(req, {
      request_id: logger.requestId,
      endpoint: "game-start",
      action: "start",
      game_id: gameId,
    }),
  );
  const narrationParts = [
    createNarrationPart(narration, NARRATOR_SPEAKER, blueprint.metadata.image_id ?? null),
    createNarrationPart(NOTEBOOK_GUIDANCE, NARRATOR_SPEAKER),
  ];

  const startEvent = {
    session_id: gameId,
    event_type: "start",
    actor: "system",
    payload: startPayload(blueprint),
    narration_parts: narrationParts,
    model: provider.resolvedModel,
    diagnostics: startDiagnostics(blueprint),
    logger,
  };

  try {
    await ctx.sessions.saveTurn({
      game_id: gameId,
      expected_sequence: 1,
      start: {
        player_id: ctx.player.id,
        blueprint_id: blueprint.id,
        ai_profile_id: profile.id,
        mode: "explore",
        current_location_id: blueprint.world.starting_location_id,
        time_remaining: blueprint.metadata.time_budget,
      },
      events: [buildNarrationEvent(startEvent, 1)],
    });
  } catch (saveError) {
    logger.logError("request.error", {
      reason: "start_save_failed",
      game_id: gameId,
      blueprint_id: blueprint.id,
      error: saveError instanceof Error ? saveError.message : String(saveError),
    });
    return null;
  }
  logNarrationEventSaved(startEvent, 1);

  return { gameId, narrationParts };
}

function startResponse(
  blueprint: BlueprintV2,
  opened: { gameId: string; narrationParts: ReturnType<typeof createNarrationPart>[] },
): Response {
  const state = buildGameState(blueprint, {
    discovered_clues: [],
    time_remaining: blueprint.metadata.time_budget,
    location: blueprint.world.starting_location_id,
    mode: "explore",
    current_talk_character: null,
  });
  const event = {
    sequence: 1,
    event_type: "start",
    narration_parts: opened.narrationParts,
    payload: { ...startPayload(blueprint), diagnostics: startDiagnostics(blueprint, 1) },
  };
  return new Response(
    JSON.stringify({ game_id: opened.gameId, state, narration_events: [event] }),
    { headers: JSON_HEADERS },
  );
}

async function loadBlueprint(ctx: EngineContext, id: string, logger: LogWriter) {
  try {
    return { blueprint: await ctx.content.loadBlueprint(id, logger) };
  } catch {
    logger.logError("request.error", { reason: "storage_list_failed" });
    return { failed: internalError("Failed to access blueprints") };
  }
}

export async function handle(
  req: Request,
  ctx: EngineContext,
): Promise<Response> {
  const logger = createRequestLogger(req, "game-start");
  const { log, logError } = logger;

  try {
    const read = await readJsonRequest(req, GameStartRequestSchema, logger);
    if (!read.ok) return read.response;
    const { blueprint_id, ai_profile } = read.data;

    const resolved = await resolveProfile(ctx, ai_profile, logger);
    if (resolved.response) return resolved.response;

    const loaded = await loadBlueprint(ctx, blueprint_id, logger);
    if (loaded.failed) return loaded.failed;
    const { blueprint } = loaded;
    if (!blueprint) {
      log("request.invalid", { reason: "blueprint_not_found", blueprint_id });
      return notFound("Blueprint not found");
    }

    const opened = await openCase(req, ctx, logger, blueprint, resolved.profile);
    if (!opened) return internalError("Failed to start game");
    return startResponse(blueprint, opened);
  } catch (err) {
    if (err instanceof RetriableAIError) {
      log("request.ai_retriable", {
        code: err.details.code ?? null,
        status: err.details.status ?? null,
        error: err.message,
      });
    }
    const aiResponse = asRetriableAIResponse(err);
    if (aiResponse) return aiResponse;
    logError("request.unhandled_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return internalError("Internal Server Error");
  }
}
