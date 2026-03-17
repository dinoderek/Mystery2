import { requireAuth, isAuthError, type AuthResult } from "../_shared/auth.ts";
import {
  aiRetriableError,
  badRequest,
  internalError,
  RetriableAIError,
} from "../_shared/errors.ts";
import {
  resolveAccusationAction,
  validateTransition,
} from "../_shared/state-machine.ts";
import {
  createAIRequestMetadata,
  createAIProviderFromProfile,
} from "../_shared/ai-provider.ts";
import { getAIProfileById } from "../_shared/ai-profile.ts";
import { createRequestLogger } from "../_shared/logging.ts";
import {
  getCharacterByKey,
  getLocationByKey,
  loadBlueprintFromStorage,
} from "../_shared/blueprints/runtime.ts";
import {
  parseAccusationJudgeOutput,
  parseAccusationStartOutput,
} from "../_shared/ai-contracts.ts";
import {
  buildAccusationJudgeContext,
  buildAccusationStartContext,
} from "../_shared/ai-context.ts";
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
  const logger = createRequestLogger(req, "game-accuse");
  const { requestId, log, logError } = logger;

  try {
    const body = await req.json();
    if (!body || !body.game_id) {
      log("request.invalid", { reason: "missing_game_id" });
      return badRequest("Missing game_id");
    }

    const gameId = String(body.game_id);
    const playerReasoning =
      typeof body.player_reasoning === "string"
        ? body.player_reasoning.trim()
        : "";
    const accusationHistoryMode =
      body.accusation_history_mode === "none" ? "none" : "all";

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
      return badRequest("Session state is incompatible with Blueprint V2");
    }

    const culprit = getCharacterByKey(
      blueprint,
      blueprint.ground_truth.culprit_character_key,
    );
    if (!culprit) {
      return internalError("Blueprint culprit is invalid");
    }

    const { data: historyRows } = await userClient
      .from("game_events")
      .select("sequence,event_type,actor,narration,payload")
      .eq("session_id", gameId)
      .order("sequence", { ascending: true });
    const history = historyRows ?? [];

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

    const runReasoningRound = async (
      contextSession: typeof session,
    ): Promise<Response> => {
      const accusationRounds = history.filter(
        (entry) => entry.event_type === "accuse_round",
      ).length;

      const aiContext = buildAccusationJudgeContext({
        game_id: gameId,
        session: {
          ...contextSession,
          mode: "accuse",
          current_talk_character_id: null,
        },
        blueprint,
        player_input: playerReasoning,
        round: accusationRounds,
        conversation_history: history,
        history_mode: accusationHistoryMode,
      });

      const promptTemplate = await loadPromptTemplate("accusation_judge");
      const prompt = renderPrompt(promptTemplate, {
        forced_context: "",
      });
      const aiMetadata = createAIRequestMetadata(req, {
        request_id: requestId,
        endpoint: "game-accuse",
        action: "accuse_reasoning",
        game_id: gameId,
      });

      let judgeOutput: ReturnType<typeof parseAccusationJudgeOutput>;
      try {
        judgeOutput = await aiProvider.generateRoleOutput({
          role: "accusation_judge",
          prompt,
          context: {
            ...aiContext,
            round: accusationRounds,
          },
          parse: parseAccusationJudgeOutput,
          metadata: aiMetadata,
        });
      } catch (error) {
        if (error instanceof RetriableAIError) {
          log("request.ai_retriable", {
            game_id: gameId,
            action: "accuse_reasoning",
            code: error.details.code ?? null,
            status: error.details.status ?? null,
            error: error.message,
          });
          return aiRetriableError(error.message, error.details);
        }
        log("request.ai_retriable", {
          game_id: gameId,
          action: "accuse_reasoning",
          code: "AI_INVALID_OUTPUT",
          error: "AI output validation failed",
        });
        return aiRetriableError("AI output validation failed", {
          code: "AI_INVALID_OUTPUT",
        });
      }

      if (judgeOutput.accusation_resolution === "continue") {
        const { error: updateError } = await userClient
          .from("game_sessions")
          .update({
            mode: "accuse",
            outcome: null,
            current_talk_character_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", gameId);
        if (updateError) {
          logError("request.error", {
            reason: "session_update_failed",
            game_id: gameId,
            action: "accuse_reasoning",
          });
          return internalError("Failed to update session");
        }

        const nextSequence = await getNextSequence(userClient, gameId);
        await userClient.from("game_events").insert({
          session_id: gameId,
          sequence: nextSequence,
          event_type: "accuse_round",
          actor: "system",
          payload: {
            role: "accusation_judge",
            player_reasoning: playerReasoning,
            judge_result: "continue",
            location_name: activeLocation.name,
            location_key: activeLocation.location_key,
            speaker: NARRATOR_SPEAKER,
          },
          narration: judgeOutput.narration,
          narration_parts: [judgeOutput.narration],
        });

        return new Response(
          JSON.stringify({
            narration: judgeOutput.narration,
            mode: "accuse",
            result: null,
            follow_up_prompt: judgeOutput.follow_up_prompt,
            speaker: NARRATOR_SPEAKER,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      if (
        judgeOutput.accusation_resolution !== "win" &&
        judgeOutput.accusation_resolution !== "lose"
      ) {
        log("request.ai_retriable", {
          game_id: gameId,
          action: "accuse_reasoning",
          code: "AI_INVALID_OUTPUT",
          error: "Terminal accusation response with invalid resolution",
        });
        return aiRetriableError("AI output validation failed", {
          code: "AI_INVALID_OUTPUT",
        });
      }

      const outcome = judgeOutput.accusation_resolution;
      const { error: updateError } = await userClient
        .from("game_sessions")
        .update({
          mode: "ended",
          outcome,
          current_talk_character_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", gameId);
      if (updateError) {
        logError("request.error", {
          reason: "session_update_failed",
          game_id: gameId,
          action: "accuse_reasoning",
        });
        return internalError("Failed to update session");
      }

      const nextSequence = await getNextSequence(userClient, gameId);
      await userClient.from("game_events").insert({
        session_id: gameId,
        sequence: nextSequence,
        event_type: "accuse_resolved",
        actor: "system",
        payload: {
          role: "accusation_judge",
          player_reasoning: playerReasoning,
          judge_result: outcome,
          culprit_character_key: culprit.character_key,
          culprit_character_name: culprit.first_name,
          location_name: activeLocation.name,
          location_key: activeLocation.location_key,
          speaker: NARRATOR_SPEAKER,
        },
        narration: judgeOutput.narration,
        narration_parts: [judgeOutput.narration],
      });

      return new Response(
        JSON.stringify({
          narration: judgeOutput.narration,
          mode: "ended",
          result: outcome,
          follow_up_prompt: null,
          speaker: NARRATOR_SPEAKER,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    };

    if (session.mode === "explore") {
      validateTransition(session.mode, resolveAccusationAction(session.mode));

      if (playerReasoning.length === 0) {
        const aiContext = buildAccusationStartContext({
          game_id: gameId,
          session: {
            ...session,
            mode: "accuse",
            current_talk_character_id: null,
          },
          blueprint,
          player_input: null,
          conversation_history: history,
          history_mode: accusationHistoryMode,
        });

        const promptTemplate = await loadPromptTemplate("accusation_start");
        const prompt = renderPrompt(promptTemplate, {
          forced_context: "",
        });
        const aiMetadata = createAIRequestMetadata(req, {
          request_id: requestId,
          endpoint: "game-accuse",
          action: "accuse_start",
          game_id: gameId,
        });

        let startOutput: ReturnType<typeof parseAccusationStartOutput>;
        try {
          startOutput = await aiProvider.generateRoleOutput({
            role: "accusation_start",
            prompt,
            context: aiContext,
            parse: parseAccusationStartOutput,
            metadata: aiMetadata,
          });
        } catch (error) {
          if (error instanceof RetriableAIError) {
            log("request.ai_retriable", {
              game_id: gameId,
              action: "accuse_start",
              code: error.details.code ?? null,
              status: error.details.status ?? null,
              error: error.message,
            });
            return aiRetriableError(error.message, error.details);
          }
          log("request.ai_retriable", {
            game_id: gameId,
            action: "accuse_start",
            code: "AI_INVALID_OUTPUT",
            error: "AI output validation failed",
          });
          return aiRetriableError("AI output validation failed", {
            code: "AI_INVALID_OUTPUT",
          });
        }

        const { error: updateError } = await userClient
          .from("game_sessions")
          .update({
            mode: "accuse",
            current_talk_character_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", gameId);
        if (updateError) {
          logError("request.error", {
            reason: "session_update_failed",
            game_id: gameId,
            action: "accuse_start",
          });
          return internalError("Failed to update session");
        }

        const nextSequence = await getNextSequence(userClient, gameId);
        await userClient.from("game_events").insert({
          session_id: gameId,
          sequence: nextSequence,
          event_type: "accuse_start",
          actor: "player",
          payload: {
            role: "accusation_start",
            trigger: "player",
            location_name: activeLocation.name,
            location_key: activeLocation.location_key,
            speaker: NARRATOR_SPEAKER,
          },
          narration: startOutput.narration,
          narration_parts: [startOutput.narration],
        });

        return new Response(
          JSON.stringify({
            narration: startOutput.narration,
            mode: "accuse",
            result: null,
            follow_up_prompt: startOutput.follow_up_prompt,
            speaker: NARRATOR_SPEAKER,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      return await runReasoningRound({
        ...session,
        mode: "accuse",
        current_talk_character_id: null,
      });
    }

    if (session.mode === "accuse") {
      validateTransition(session.mode, resolveAccusationAction(session.mode));
      if (playerReasoning.length === 0) {
        log("request.invalid", {
          reason: "missing_player_reasoning",
          game_id: gameId,
        });
        return badRequest("Missing player_reasoning");
      }

      return await runReasoningRound(session);
    }

    return badRequest(`Cannot accuse while in mode "${session.mode}"`);
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
