import { requireAuth, isAuthError, type AuthResult } from "../_shared/auth.ts";
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
import {
  getCharacterByKey,
  getEvidenceSummary,
  getLocationByKey,
  loadBlueprintFromStorage,
} from "../_shared/blueprints/runtime.ts";
import { parseTalkConversationOutput } from "../_shared/ai-contracts.ts";
import { buildTalkConversationContext } from "../_shared/ai-context.ts";
import { generateForcedAccusationStartNarration } from "../_shared/forced-endgame.ts";
import { loadPromptTemplate, renderPrompt } from "../_shared/ai-prompts.ts";
import {
  createCharacterSpeaker,
  NARRATOR_SPEAKER,
} from "../_shared/speaker.ts";
import { serveWithCors } from "../_shared/cors.ts";

async function getNextSequence(
  db: AuthResult["client"],
  gameId: string,
): Promise<number> {
  const { data: events } = await db
    .from("game_events")
    .select("sequence")
    .eq("session_id", gameId)
    .order("sequence", { ascending: false })
    .limit(1);

  return events && events.length > 0 ? events[0].sequence + 1 : 1;
}

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
    const playerInput =
      typeof body.player_input === "string" ? body.player_input.trim() : "";

    if (playerInput.length === 0) {
      log("request.invalid", { reason: "missing_player_input", game_id: gameId });
      return badRequest("Missing player_input");
    }

    const authResult = await requireAuth(req);
    if (isAuthError(authResult)) {
      return authResult;
    }
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

    const blueprint = await loadBlueprintFromStorage(userClient, session.blueprint_id);
    if (!blueprint) {
      return internalError("Blueprint missing");
    }

    const activeCharacter = getCharacterByKey(
      blueprint,
      session.current_talk_character_id,
    );
    if (!activeCharacter) {
      return internalError("Character missing in blueprint");
    }

    const activeLocation = getLocationByKey(blueprint, session.current_location_id);
    if (!activeLocation) {
      return internalError("Current location not found in blueprint");
    }

    const { data: historyRows } = await userClient
      .from("game_events")
      .select("sequence,event_type,actor,narration,payload")
      .eq("session_id", gameId)
      .order("sequence", { ascending: true });

    const newTime = session.time_remaining - 1;
    const isForcedEndgame = newTime <= 0;
    const nextMode = isForcedEndgame ? "accuse" : "talk";
    const eventType = isForcedEndgame ? "forced_endgame" : "ask";
    const characterSpeaker = createCharacterSpeaker(activeCharacter.first_name);
    let narration: string;
    let eventPayload: Record<string, unknown>;
    let responseSpeaker = characterSpeaker;

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
            current_talk_character_id: null,
          },
          blueprint,
          conversation_history: historyRows ?? [],
          scene_summary:
            `The investigator asked ${activeCharacter.first_name} a final question, and that last moment used up all remaining time.`,
        });
        narration = forcedOutput.narration;
        eventPayload = {
          role: "accusation_start",
          character_name: activeCharacter.first_name,
          character_key: activeCharacter.character_key,
          location_name: activeLocation.name,
          location_key: activeLocation.location_key,
          player_input: playerInput,
          evidence: getEvidenceSummary(blueprint, "talk", {
            location_key: activeLocation.location_key,
            character_key: activeCharacter.character_key,
          }),
          narration_parts: [narration],
          trigger: "timeout",
          follow_up_prompt: forcedOutput.follow_up_prompt,
          speaker: NARRATOR_SPEAKER,
        };
        responseSpeaker = NARRATOR_SPEAKER;
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
    } else {
      const aiContext = buildTalkConversationContext({
        game_id: gameId,
        session,
        blueprint,
        character_name: activeCharacter.first_name,
        player_input: playerInput,
        location_name: activeLocation.name,
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
      narration = talkOutput.narration;
      eventPayload = {
        role: "talk_conversation",
        character_name: activeCharacter.first_name,
        character_key: activeCharacter.character_key,
        location_name: activeLocation.name,
        location_key: activeLocation.location_key,
        player_input: playerInput,
        evidence: getEvidenceSummary(blueprint, "talk", {
          location_key: activeLocation.location_key,
          character_key: activeCharacter.character_key,
        }),
        narration_parts: [narration],
        speaker: characterSpeaker,
      };
    }

    const { error: updateError } = await userClient
      .from("game_sessions")
      .update({
        time_remaining: newTime,
        mode: nextMode,
        current_talk_character_id: isForcedEndgame
          ? null
          : activeCharacter.character_key,
        updated_at: new Date().toISOString(),
      })
      .eq("id", gameId);
    if (updateError) {
      return internalError("Failed to update session");
    }

    const nextSequence = await getNextSequence(userClient, gameId);
    await userClient.from("game_events").insert({
      session_id: gameId,
      sequence: nextSequence,
      event_type: eventType,
      actor: "system",
      payload: eventPayload,
      narration,
      narration_parts: [narration],
    });

    return new Response(
      JSON.stringify({
        narration,
        current_talk_character: isForcedEndgame ? null : activeCharacter.first_name,
        time_remaining: newTime,
        mode: nextMode,
        character_portrait_image_id: activeCharacter.portrait_image_id ?? null,
        speaker: responseSpeaker,
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
