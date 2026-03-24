import { requireAuth, isAuthError } from "../_shared/auth.ts";
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
import { getAIProfileById } from "../_shared/ai-profile.ts";
import { createRequestLogger } from "../_shared/logging.ts";
import { BlueprintV2Schema } from "../_shared/blueprints/blueprint-schema-v2.ts";
import { parseTalkStartOutput } from "../_shared/ai-contracts.ts";
import { buildTalkStartContext } from "../_shared/ai-context.ts";
import { loadPromptTemplate, renderPrompt } from "../_shared/ai-prompts.ts";
import {
  createNarrationDiagnostics,
  createNarrationPart,
  insertNarrationEvent,
} from "../_shared/narration.ts";
import { NARRATOR_SPEAKER } from "../_shared/speaker.ts";
import { serveWithCors } from "../_shared/cors.ts";

serveWithCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const logger = createRequestLogger(req, "game-talk");
  const { requestId, log, logError } = logger;

  try {
    const body = await req.json();
    if (!body || !body.game_id || !body.character_id) {
      log("request.invalid", { reason: "missing_game_id_or_character_id" });
      return badRequest("Missing game_id or character_id");
    }

    // Authenticate user
    const authResult = await requireAuth(req);
    if (isAuthError(authResult)) return authResult;
    const { client: userClient } = authResult;

    const gameId = String(body.game_id);
    const characterId = String(body.character_id);

    const { data: session, error: sessionError } = await userClient
      .from("game_sessions")
      .select("*")
      .eq("id", gameId)
      .single();
    if (sessionError || !session) {
      log("request.invalid", { reason: "session_not_found", game_id: gameId });
      return badRequest("Game session not found");
    }

    validateTransition(session.mode, "talk");

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

    const { data: fileData, error: downloadError } = await userClient.storage
      .from("blueprints")
      .download(`${session.blueprint_id}.json`);
    if (downloadError) {
      logError("request.error", {
        reason: "blueprint_missing",
        game_id: gameId,
      });
      return internalError("Blueprint missing");
    }

    const blueprint = BlueprintV2Schema.parse(JSON.parse(await fileData.text()));
    const activeCharacter = blueprint.world.characters.find(
      (character) =>
        character.id === characterId &&
        character.location_id === session.current_location_id,
    );
    if (!activeCharacter) {
      log("request.invalid", {
        reason: "character_not_found_in_location",
        game_id: gameId,
        character_id: characterId,
        location_id: session.current_location_id,
      });
      return badRequest(
        `Character ${characterId} not found in current location`,
      );
    }

    const { data: historyRows } = await userClient
      .from("game_events")
      .select("sequence,event_type,actor,narration,payload")
      .eq("session_id", gameId)
      .order("sequence", { ascending: true });

    const aiContext = buildTalkStartContext({
      game_id: gameId,
      session,
      blueprint,
      character_id: activeCharacter.id,
      location_id: session.current_location_id,
      conversation_history: historyRows ?? [],
    });

    const promptTemplate = await loadPromptTemplate("talk_start");
    const prompt = renderPrompt(promptTemplate, {
      character_name: activeCharacter.first_name,
      location_name: blueprint.world.locations.find(
        (l) => l.id === session.current_location_id,
      )?.name ?? session.current_location_id,
      target_age: blueprint.metadata.target_age,
    });
    const aiMetadata = createAIRequestMetadata(req, {
      request_id: requestId,
      endpoint: "game-talk",
      action: "talk",
      game_id: gameId,
    });

    let talkStartOutput: ReturnType<typeof parseTalkStartOutput>;
    try {
      talkStartOutput = await aiProvider.generateRoleOutput({
        role: "talk_start",
        prompt,
        context: aiContext,
        parse: parseTalkStartOutput,
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

    const narrationParts = [
      createNarrationPart(
        talkStartOutput.narration,
        NARRATOR_SPEAKER,
        activeCharacter.portrait_image_id ?? null,
      ),
    ];

    const { error: updateError } = await userClient
      .from("game_sessions")
      .update({
        time_remaining: session.time_remaining,
        mode: "talk",
        current_talk_character_id: activeCharacter.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", gameId);
    if (updateError) {
      logError("request.error", {
        reason: "session_update_failed",
        game_id: gameId,
      });
      return internalError("Failed to update session");
    }

    await insertNarrationEvent(userClient, {
      session_id: gameId,
      event_type: "talk",
      actor: "system",
      payload: {
        role: "talk_start",
        character_id: activeCharacter.id,
        character_name: activeCharacter.first_name,
        location_id: session.current_location_id,
        character_portrait_image_id: activeCharacter.portrait_image_id ?? null,
        speaker: NARRATOR_SPEAKER,
      },
      narration_parts: narrationParts,
      diagnostics: createNarrationDiagnostics({
        action: "talk",
        event_category: "talk",
        mode: "explore",
        resulting_mode: "talk",
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
        mode: "talk",
        current_talk_character: activeCharacter.id,
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
});
