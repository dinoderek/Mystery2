import type { EngineContext } from "../_shared/context.ts";
import { requireEngineContext } from "../_shared/context-supabase.ts";
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
import { createRequestLogger } from "../_shared/logging.ts";
import {
  parseAccusationJudgeOutput,
  parseAccusationStartOutput,
} from "../_shared/ai-contracts.ts";
import { buildRoleRequest } from "../_shared/role-request.ts";
import {
  createNarrationDiagnostics,
  createNarrationPart,
  insertNarrationEvent,
} from "../_shared/narration.ts";
import { NARRATOR_SPEAKER } from "../_shared/speaker.ts";
import { serveWithCors } from "../_shared/cors.ts";

export async function handle(
  req: Request,
  ctx: EngineContext,
): Promise<Response> {
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

    const session = await ctx.sessions.getById(gameId);
    if (!session) {
      log("request.invalid", { reason: "session_not_found", game_id: gameId });
      return badRequest("Game session not found");
    }

    const blueprint = await ctx.content.loadBlueprint(session.blueprint_id, logger);
    if (!blueprint) {
      return internalError("Blueprint missing");
    }

    const historyRows = await ctx.events.listBySession(gameId);
    const history = historyRows ?? [];

    const aiProfile = await ctx.aiProfiles.getById(session.ai_profile_id);
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

      const { prompt, context: aiContext } = await buildRoleRequest({
        role: "accusation_judge",
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
        try {
          await ctx.sessions.update(gameId, {
            mode: "accuse",
            outcome: null,
            current_talk_character_id: null,
            updated_at: new Date().toISOString(),
          });
        } catch {
          logError("request.error", {
            reason: "session_update_failed",
            game_id: gameId,
            action: "accuse_reasoning",
          });
          return internalError("Failed to update session");
        }

        const narrationParts = [
          createNarrationPart(judgeOutput.narration, NARRATOR_SPEAKER),
        ];
        await insertNarrationEvent(ctx.events, {
          session_id: gameId,
          event_type: "accuse_round",
          actor: "system",
          payload: {
            role: "accusation_judge",
            player_reasoning: playerReasoning,
            judge_result: "continue",
            follow_up_prompt: judgeOutput.follow_up_prompt,
            speaker: NARRATOR_SPEAKER,
          },
          narration_parts: narrationParts,
          model: aiProvider.resolvedModel,
          diagnostics: createNarrationDiagnostics({
            action: "accuse_reasoning",
            event_category: "accuse_round",
            mode: "accuse",
            resulting_mode: "accuse",
            time_before: contextSession.time_remaining,
            time_after: contextSession.time_remaining,
            time_consumed: false,
            forced_endgame: false,
            trigger: "player",
          }),
          logger,
        });

        return new Response(
          JSON.stringify({
            narration_parts: narrationParts,
            time_remaining: contextSession.time_remaining,
            mode: "accuse",
            current_talk_character: null,
            result: null,
            follow_up_prompt: judgeOutput.follow_up_prompt,
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
      try {
        await ctx.sessions.update(gameId, {
          mode: "ended",
          outcome,
          current_talk_character_id: null,
          updated_at: new Date().toISOString(),
        });
      } catch {
        logError("request.error", {
          reason: "session_update_failed",
          game_id: gameId,
          action: "accuse_reasoning",
        });
        return internalError("Failed to update session");
      }

      const narrationParts = [
        createNarrationPart(judgeOutput.narration, NARRATOR_SPEAKER),
      ];
      await insertNarrationEvent(ctx.events, {
        session_id: gameId,
        event_type: "accuse_resolved",
        actor: "system",
        payload: {
          role: "accusation_judge",
          player_reasoning: playerReasoning,
          judge_result: outcome,
          speaker: NARRATOR_SPEAKER,
        },
        narration_parts: narrationParts,
        model: aiProvider.resolvedModel,
        diagnostics: createNarrationDiagnostics({
          action: "accuse_reasoning",
          event_category: "accuse_resolved",
          mode: "accuse",
          resulting_mode: "ended",
          time_before: contextSession.time_remaining,
          time_after: contextSession.time_remaining,
          time_consumed: false,
          forced_endgame: false,
          trigger: "player",
        }),
        logger,
      });

      return new Response(
        JSON.stringify({
          narration_parts: narrationParts,
          time_remaining: contextSession.time_remaining,
          mode: "ended",
          current_talk_character: null,
          result: outcome,
          follow_up_prompt: null,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    };

    if (session.mode === "explore") {
      validateTransition(session.mode, resolveAccusationAction(session.mode));

      if (playerReasoning.length === 0) {
        const { prompt, context: aiContext } = await buildRoleRequest({
          role: "accusation_start",
          game_id: gameId,
          session: {
            ...session,
            mode: "accuse",
            current_talk_character_id: null,
          },
          blueprint,
          conversation_history: history,
          history_mode: accusationHistoryMode,
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

        try {
          await ctx.sessions.update(gameId, {
            mode: "accuse",
            current_talk_character_id: null,
            updated_at: new Date().toISOString(),
          });
        } catch {
          logError("request.error", {
            reason: "session_update_failed",
            game_id: gameId,
            action: "accuse_start",
          });
          return internalError("Failed to update session");
        }

        const narrationParts = [
          createNarrationPart(startOutput.narration, NARRATOR_SPEAKER),
        ];
        await insertNarrationEvent(ctx.events, {
          session_id: gameId,
          event_type: "accuse_start",
          actor: "player",
          payload: {
            role: "accusation_start",
            trigger: "player",
            follow_up_prompt: startOutput.follow_up_prompt,
            speaker: NARRATOR_SPEAKER,
          },
          narration_parts: narrationParts,
          model: aiProvider.resolvedModel,
          diagnostics: createNarrationDiagnostics({
            action: "accuse_start",
            event_category: "accuse_start",
            mode: "explore",
            resulting_mode: "accuse",
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
            mode: "accuse",
            current_talk_character: null,
            result: null,
            follow_up_prompt: startOutput.follow_up_prompt,
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
}

serveWithCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const ctx = await requireEngineContext(req);
  if (ctx instanceof Response) return ctx;

  return handle(req, ctx);
});
