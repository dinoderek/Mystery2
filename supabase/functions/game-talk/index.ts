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
  findCharacterByName,
  getEvidenceSummary,
  getLocationByKey,
  loadBlueprintFromStorage,
} from "../_shared/blueprints/runtime.ts";
import { parseTalkStartOutput } from "../_shared/ai-contracts.ts";
import { buildTalkStartContext } from "../_shared/ai-context.ts";
import { generateForcedAccusationStartNarration } from "../_shared/forced-endgame.ts";
import { loadPromptTemplate, renderPrompt } from "../_shared/ai-prompts.ts";
import { NARRATOR_SPEAKER } from "../_shared/speaker.ts";
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
  const logger = createRequestLogger(req, "game-talk");
  const { requestId, log, logError } = logger;

  try {
    const body = await req.json();
    if (!body || !body.game_id || !body.character_name) {
      log("request.invalid", { reason: "missing_game_id_or_character_name" });
      return badRequest("Missing game_id or character_name");
    }

    const authResult = await requireAuth(req);
    if (isAuthError(authResult)) {
      return authResult;
    }
    const { client: userClient } = authResult;

    const gameId = String(body.game_id);
    const characterName = String(body.character_name);

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

    const blueprint = await loadBlueprintFromStorage(userClient, session.blueprint_id);
    if (!blueprint) {
      logError("request.error", {
        reason: "blueprint_missing",
        game_id: gameId,
      });
      return internalError("Blueprint missing");
    }

    const activeLocation = getLocationByKey(blueprint, session.current_location_id);
    if (!activeLocation) {
      logError("request.error", {
        reason: "current_location_missing_in_blueprint",
        game_id: gameId,
        location_key: session.current_location_id,
      });
      return internalError("Current location not found in blueprint");
    }

    const activeCharacter = findCharacterByName(blueprint, characterName, {
      locationKey: activeLocation.location_key,
    });
    if (!activeCharacter) {
      log("request.invalid", {
        reason: "character_not_found_in_location",
        game_id: gameId,
        character_name: characterName,
        location_key: activeLocation.location_key,
      });
      return badRequest(
        `Character ${characterName} not found in ${activeLocation.name}`,
      );
    }

    const { data: historyRows } = await userClient
      .from("game_events")
      .select("sequence,event_type,actor,narration,payload")
      .eq("session_id", gameId)
      .order("sequence", { ascending: true });

    const newTime = session.time_remaining - 1;
    const isForcedEndgame = newTime <= 0;
    const nextMode = isForcedEndgame ? "accuse" : "talk";
    const eventType = isForcedEndgame ? "forced_endgame" : "talk";
    let narration: string;
    let eventPayload: Record<string, unknown>;

    if (isForcedEndgame) {
      try {
        const forcedOutput = await generateForcedAccusationStartNarration({
          req,
          request_id: requestId,
          endpoint: "game-talk",
          game_id: gameId,
          aiProvider,
          session: {
            ...session,
            current_talk_character_id: null,
          },
          blueprint,
          conversation_history: historyRows ?? [],
          scene_summary:
            `The investigator started talking to ${activeCharacter.first_name}, but time expired before the interview could continue.`,
        });
        narration = forcedOutput.narration;
        eventPayload = {
          role: "accusation_start",
          character_name: activeCharacter.first_name,
          character_key: activeCharacter.character_key,
          location_name: activeLocation.name,
          location_key: activeLocation.location_key,
          character_portrait_image_id: activeCharacter.portrait_image_id ?? null,
          evidence: getEvidenceSummary(blueprint, "talk", {
            location_key: activeLocation.location_key,
            character_key: activeCharacter.character_key,
          }),
          narration_parts: [narration],
          trigger: "timeout",
          follow_up_prompt: forcedOutput.follow_up_prompt,
          speaker: NARRATOR_SPEAKER,
        };
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
      const aiContext = buildTalkStartContext({
        game_id: gameId,
        session,
        blueprint,
        character_name: activeCharacter.first_name,
        location_name: activeLocation.name,
        conversation_history: historyRows ?? [],
      });

      const promptTemplate = await loadPromptTemplate("talk_start");
      const prompt = renderPrompt(promptTemplate, {
        character_name: activeCharacter.first_name,
        location_name: activeLocation.name,
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
      narration = talkStartOutput.narration;
      eventPayload = {
        role: "talk_start",
        character: activeCharacter.first_name,
        character_name: activeCharacter.first_name,
        character_key: activeCharacter.character_key,
        location_name: activeLocation.name,
        location_key: activeLocation.location_key,
        character_portrait_image_id: activeCharacter.portrait_image_id ?? null,
        evidence: getEvidenceSummary(blueprint, "talk", {
          location_key: activeLocation.location_key,
          character_key: activeCharacter.character_key,
        }),
        narration_parts: [narration],
        speaker: NARRATOR_SPEAKER,
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
      logError("request.error", {
        reason: "session_update_failed",
        game_id: gameId,
      });
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
        mode: nextMode,
        time_remaining: newTime,
        character_portrait_image_id: activeCharacter.portrait_image_id ?? null,
        speaker: NARRATOR_SPEAKER,
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
