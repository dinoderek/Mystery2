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
import { createRequestLogger, withLogContext } from "../_shared/logging.ts";
import { BlueprintSchema } from "../_shared/blueprints/blueprint-schema.ts";
import { parseTalkConversationOutput } from "../_shared/ai-contracts.ts";
import { buildTalkConversationContext } from "../_shared/ai-context.ts";
import { generateForcedAccusationStartNarration } from "../_shared/forced-endgame.ts";
import { loadPromptTemplate, renderPrompt } from "../_shared/ai-prompts.ts";
import {
  createNarrationDiagnostics,
  createNarrationPart,
  insertNarrationEvent,
} from "../_shared/narration.ts";
import {
  createCharacterSpeaker,
  NARRATOR_SPEAKER,
} from "../_shared/speaker.ts";
import { serveWithCors } from "../_shared/cors.ts";

serveWithCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const logger = createRequestLogger(req, "game-ask");
  const { requestId, log, logError } = logger;

  try {
    const body = await req.json();
    if (!body || !body.game_id) {
      log("request.invalid", { reason: "missing_game_id" });
      return badRequest("Missing game_id");
    }

    const gameId = String(body.game_id);
    const narrationLogger = withLogContext(logger, { game_id: gameId });
    const playerInput =
      typeof body.player_input === "string" ? body.player_input.trim() : "";

    if (playerInput.length === 0) {
      log("request.invalid", { reason: "missing_player_input", game_id: gameId });
      return badRequest("Missing player_input");
    }

    // Authenticate user
    const authResult = await requireAuth(req);
    if (isAuthError(authResult)) return authResult;
    const { client: userClient } = authResult;

    const { data: session, error: sessionError } = await userClient
      .from("game_sessions")
      .select("*")
      .eq("id", gameId)
      .single();
    if (sessionError || !session) {
      log("request.invalid", { reason: "session_not_found", game_id: gameId });
      return badRequest("Game session not found");
    }

    validateTransition(session.mode, "ask");
    if (!session.current_talk_character_id) {
      log("request.invalid", { reason: "no_active_talk_character", game_id: gameId });
      return badRequest("Not talking to anyone");
    }

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
      return internalError("Blueprint missing");
    }

    const blueprint = BlueprintSchema.parse(JSON.parse(await fileData.text()));
    const activeCharacter = blueprint.world.characters.find(
      (character) => character.first_name === session.current_talk_character_id,
    );
    if (!activeCharacter) {
      return internalError("Character missing in blueprint");
    }

    const { data: historyRows } = await userClient
      .from("game_events")
      .select("sequence,event_type,actor,narration,payload")
      .eq("session_id", gameId)
      .order("sequence", { ascending: true });

    const newTime = Math.max(session.time_remaining - 1, 0);
    const isForcedEndgame = newTime === 0;
    const nextMode = isForcedEndgame ? "accuse" : "talk";
    const characterSpeaker = createCharacterSpeaker(activeCharacter.first_name);
    const aiContext = buildTalkConversationContext({
      game_id: gameId,
      session,
      blueprint,
      character_name: activeCharacter.first_name,
      player_input: playerInput,
      location_name: session.current_location_id,
      conversation_history: historyRows ?? [],
    });

    const promptTemplate = await loadPromptTemplate("talk_conversation");
    const prompt = renderPrompt(promptTemplate, {
      character_name: activeCharacter.first_name,
      player_input: playerInput,
    });
    const aiMetadata = createAIRequestMetadata(req, {
      request_id: requestId,
      endpoint: "game-ask",
      action: "ask",
      game_id: gameId,
    });

    let talkOutput: ReturnType<typeof parseTalkConversationOutput>;
    try {
      talkOutput = await aiProvider.generateRoleOutput({
        role: "talk_conversation",
        prompt,
        context: aiContext,
        parse: parseTalkConversationOutput,
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

    const askParts = [
      createNarrationPart(
        talkOutput.narration,
        characterSpeaker,
        activeCharacter.portrait_image_id ?? null,
      ),
    ];
    let combinedParts = [...askParts];
    let followUpPrompt: string | null = null;
    let forcedParts: typeof askParts = [];

    if (isForcedEndgame) {
      try {
        const forcedOutput = await generateForcedAccusationStartNarration({
          req,
          request_id: requestId,
          endpoint: "game-ask",
          game_id: gameId,
          aiProvider,
          session: {
            ...session,
            time_remaining: newTime,
          },
          blueprint,
          conversation_history: historyRows ?? [],
          scene_summary:
            `The investigator asked ${activeCharacter.first_name} a final question, and that last moment used up all remaining time.`,
        });
        followUpPrompt = forcedOutput.follow_up_prompt;
        forcedParts = forcedOutput.narration_parts;
        combinedParts = [...askParts, ...forcedParts];
      } catch (error) {
        if (error instanceof RetriableAIError) {
          log("request.ai_retriable", {
            game_id: gameId,
            action: "forced_endgame_start",
            code: error.details.code ?? null,
            status: error.details.status ?? null,
            error: error.message,
          });
          return aiRetriableError(error.message, error.details);
        }
        log("request.ai_retriable", {
          game_id: gameId,
          action: "forced_endgame_start",
          code: "AI_INVALID_OUTPUT",
          error: "AI output validation failed",
        });
        return aiRetriableError("AI output validation failed", {
          code: "AI_INVALID_OUTPUT",
        });
      }
    }

    const { error: updateError } = await userClient
      .from("game_sessions")
      .update({
        time_remaining: newTime,
        mode: nextMode,
        current_talk_character_id: isForcedEndgame
          ? null
          : activeCharacter.first_name,
        updated_at: new Date().toISOString(),
      })
      .eq("id", gameId);
    if (updateError) {
      return internalError("Failed to update session");
    }

    const askSequence = await insertNarrationEvent(userClient, {
      session_id: gameId,
      event_type: "ask",
      actor: "system",
      payload: {
        role: "talk_conversation",
        character_name: activeCharacter.first_name,
        location_name: session.current_location_id,
        player_input: playerInput,
        character_portrait_image_id: activeCharacter.portrait_image_id ?? null,
        speaker: characterSpeaker,
      },
      narration_parts: askParts,
      diagnostics: createNarrationDiagnostics({
        action: "ask",
        event_category: "ask",
        mode: "talk",
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
        session_id: gameId,
        event_type: "forced_endgame",
        actor: "system",
        payload: {
          role: "accusation_start",
          character_name: activeCharacter.first_name,
          location_name: session.current_location_id,
          player_input: playerInput,
          trigger: "timeout",
          follow_up_prompt: followUpPrompt,
          speaker: NARRATOR_SPEAKER,
        },
        narration_parts: forcedParts,
        diagnostics: createNarrationDiagnostics({
          action: "ask",
          event_category: "forced_endgame",
          mode: "accuse",
          resulting_mode: "accuse",
          time_before: newTime,
          time_after: newTime,
          time_consumed: false,
          forced_endgame: true,
          trigger: "timeout",
          related_sequence: askSequence,
        }),
        logger: narrationLogger,
      });

      log("timeout.transition", {
        game_id: gameId,
        action: "ask",
        time_before: session.time_remaining,
        time_after: newTime,
        resulting_mode: nextMode,
        action_sequence: askSequence,
        forced_endgame_sequence: forcedSequence,
      });
    }

    return new Response(
      JSON.stringify({
        narration_parts: combinedParts,
        time_remaining: newTime,
        mode: nextMode,
        current_talk_character: isForcedEndgame
          ? null
          : activeCharacter.first_name,
        follow_up_prompt: followUpPrompt,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "BadRequestError") {
      log("request.invalid", { reason: "bad_request_error", message: error.message });
      return badRequest(error.message);
    }
    logError("request.unhandled_error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return internalError("Internal Server Error");
  }
});
