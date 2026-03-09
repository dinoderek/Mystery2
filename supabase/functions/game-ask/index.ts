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
  getAIProvider,
} from "../_shared/ai-provider.ts";
import { createRequestLogger } from "../_shared/logging.ts";
import { BlueprintSchema } from "../_shared/blueprints/blueprint-schema.ts";
import { parseTalkConversationOutput } from "../_shared/ai-contracts.ts";
import { buildTalkConversationContext } from "../_shared/ai-context.ts";
import { generateForcedAccusationStartNarration } from "../_shared/forced-endgame.ts";
import { loadPromptTemplate, renderPrompt } from "../_shared/ai-prompts.ts";
import {
  createCharacterSpeaker,
  NARRATOR_SPEAKER,
} from "../_shared/speaker.ts";

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

Deno.serve(async (req) => {
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
          session,
          blueprint,
          conversation_history: historyRows ?? [],
          scene_summary:
            `The investigator asked ${activeCharacter.first_name} a final question, and that last moment used up all remaining time.`,
        });
        narration = forcedOutput.narration;
        eventPayload = {
          role: "accusation_start",
          character_name: activeCharacter.first_name,
          location_name: session.current_location_id,
          player_input: playerInput,
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

      const aiProvider = getAIProvider();
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
        location_name: session.current_location_id,
        player_input: playerInput,
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
          : activeCharacter.first_name,
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
    });

    return new Response(
      JSON.stringify({
        narration,
        time_remaining: newTime,
        mode: nextMode,
        current_talk_character: isForcedEndgame
          ? null
          : activeCharacter.first_name,
        speaker: responseSpeaker,
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
