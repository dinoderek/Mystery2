import { createClient } from "../_shared/db.ts";
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
  getAIProvider,
} from "../_shared/ai-provider.ts";
import { createRequestLogger } from "../_shared/logging.ts";
import { BlueprintSchema } from "../_shared/blueprints/blueprint-schema.ts";
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

async function getNextSequence(
  db: ReturnType<typeof createClient>,
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

type BlueprintCharacter = ReturnType<
  typeof BlueprintSchema.parse
>["world"]["characters"][number];

function findCharacter(
  characters: BlueprintCharacter[],
  identifier: string,
): BlueprintCharacter | undefined {
  return characters.find(
    (character) =>
      character.first_name === identifier ||
      `${character.first_name} ${character.last_name}` === identifier,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAccusedCharacterFromStartEvent(
  event: { payload: unknown } | undefined,
): string | null {
  if (!event || !isRecord(event.payload)) {
    return null;
  }

  const accused = event.payload.accused_character_id;
  return typeof accused === "string" ? accused : null;
}

Deno.serve(async (req) => {
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
    const accusedCharacterInput =
      typeof body.accused_character_id === "string"
        ? body.accused_character_id
        : null;
    const accusationHistoryMode =
      body.accusation_history_mode === "none" ? "none" : "all";

    const db = createClient();
    const { data: session, error: sessionError } = await db
      .from("game_sessions")
      .select("*")
      .eq("id", gameId)
      .single();
    if (sessionError || !session) {
      log("request.invalid", { reason: "session_not_found", game_id: gameId });
      return badRequest("Game session not found");
    }

    const { data: fileData, error: downloadError } = await db.storage
      .from("blueprints")
      .download(`${session.blueprint_id}.json`);
    if (downloadError) {
      logError("request.error", {
        reason: "blueprint_missing",
        game_id: gameId,
      });
      return internalError("Blueprint missing");
    }
    const blueprint = BlueprintSchema.parse(JSON.parse(await fileData.text()));

    const { data: historyRows } = await db
      .from("game_events")
      .select("sequence,event_type,actor,narration,payload")
      .eq("session_id", gameId)
      .order("sequence", { ascending: true });
    const history = historyRows ?? [];

    const aiProvider = getAIProvider();

    if (session.mode === "explore") {
      validateTransition(session.mode, resolveAccusationAction(session.mode));
      if (!accusedCharacterInput) {
        log("request.invalid", {
          reason: "missing_accused_character_id",
          game_id: gameId,
        });
        return badRequest("Missing accused_character_id");
      }

      const accusedCharacter = findCharacter(
        blueprint.world.characters,
        accusedCharacterInput,
      );
      if (!accusedCharacter) {
        log("request.invalid", {
          reason: "character_not_found_in_blueprint",
          game_id: gameId,
          accused_character_id: accusedCharacterInput,
        });
        return badRequest("Character not found in blueprint");
      }

      const aiContext = buildAccusationStartContext({
        game_id: gameId,
        session,
        blueprint,
        accused_character: accusedCharacter.first_name,
        player_input: playerReasoning || null,
        conversation_history: history,
        history_mode: accusationHistoryMode,
      });

      const promptTemplate = await loadPromptTemplate("accusation_start");
      const prompt = renderPrompt(promptTemplate, {
        accused_character: accusedCharacter.first_name,
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

      const { error: updateError } = await db
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

      const nextSequence = await getNextSequence(db, gameId);
      await db.from("game_events").insert({
        session_id: gameId,
        sequence: nextSequence,
        event_type: "accuse_start",
        actor: "system",
        payload: {
          role: "accusation_start",
          accused_character_id: accusedCharacter.first_name,
          speaker: NARRATOR_SPEAKER,
        },
        narration: startOutput.narration,
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

    if (session.mode === "accuse") {
      validateTransition(session.mode, resolveAccusationAction(session.mode));
      if (playerReasoning.length === 0) {
        log("request.invalid", {
          reason: "missing_player_reasoning",
          game_id: gameId,
        });
        return badRequest("Missing player_reasoning");
      }

      const latestAccuseStart = [...history]
        .reverse()
        .find((entry) => entry.event_type === "accuse_start");
      const accusedCharacterId =
        accusedCharacterInput ??
        getAccusedCharacterFromStartEvent(latestAccuseStart) ??
        null;
      if (!accusedCharacterId) {
        log("request.invalid", {
          reason: "missing_accused_character_context",
          game_id: gameId,
        });
        return badRequest("Unable to determine accused character");
      }

      const accusedCharacter = findCharacter(
        blueprint.world.characters,
        accusedCharacterId,
      );
      if (!accusedCharacter) {
        log("request.invalid", {
          reason: "character_not_found_in_blueprint",
          game_id: gameId,
          accused_character_id: accusedCharacterId,
        });
        return badRequest("Character not found in blueprint");
      }

      const accusationRounds = history.filter(
        (entry) => entry.event_type === "accuse_round",
      ).length;
      const aiContext = buildAccusationJudgeContext({
        game_id: gameId,
        session,
        blueprint,
        accused_character: accusedCharacter.first_name,
        player_input: playerReasoning,
        round: accusationRounds,
        conversation_history: history,
        history_mode: accusationHistoryMode,
      });

      const promptTemplate = await loadPromptTemplate("accusation_judge");
      const prompt = renderPrompt(promptTemplate, {
        accused_character: accusedCharacter.first_name,
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
            is_culprit: accusedCharacter.is_culprit,
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
        const nextSequence = await getNextSequence(db, gameId);
        await db.from("game_events").insert({
          session_id: gameId,
          sequence: nextSequence,
          event_type: "accuse_round",
          actor: "system",
          payload: {
            role: "accusation_judge",
            accused_character_id: accusedCharacter.first_name,
            player_reasoning: playerReasoning,
            judge_result: "continue",
            speaker: NARRATOR_SPEAKER,
          },
          narration: judgeOutput.narration,
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

      const outcome = judgeOutput.accusation_resolution;
      const { error: updateError } = await db
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

      const nextSequence = await getNextSequence(db, gameId);
      await db.from("game_events").insert({
        session_id: gameId,
        sequence: nextSequence,
        event_type: "accuse_resolved",
        actor: "system",
        payload: {
          role: "accusation_judge",
          accused_character_id: accusedCharacter.first_name,
          player_reasoning: playerReasoning,
          judge_result: outcome,
          speaker: NARRATOR_SPEAKER,
        },
        narration: judgeOutput.narration,
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
