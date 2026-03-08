import { createClient } from "../_shared/db.ts";
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
import { parseTalkStartOutput } from "../_shared/ai-contracts.ts";
import { buildTalkStartContext } from "../_shared/ai-context.ts";
import { loadPromptTemplate, renderPrompt } from "../_shared/ai-prompts.ts";

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

Deno.serve(async (req) => {
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

    const gameId = String(body.game_id);
    const characterName = String(body.character_name);
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

    validateTransition(session.mode, "talk");

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
    const activeCharacter = blueprint.world.characters.find(
      (character) =>
        character.first_name === characterName &&
        character.location === session.current_location_id,
    );
    if (!activeCharacter) {
      log("request.invalid", {
        reason: "character_not_found_in_location",
        game_id: gameId,
        character_name: characterName,
        location_name: session.current_location_id,
      });
      return badRequest(
        `Character ${characterName} not found in ${session.current_location_id}`,
      );
    }

    const { data: historyRows } = await db
      .from("game_events")
      .select("sequence,event_type,actor,narration,payload")
      .eq("session_id", gameId)
      .order("sequence", { ascending: true });

    const aiContext = buildTalkStartContext({
      game_id: gameId,
      session,
      blueprint,
      character_name: activeCharacter.first_name,
      location_name: session.current_location_id,
      conversation_history: historyRows ?? [],
    });

    const promptTemplate = await loadPromptTemplate("talk_start");
    const prompt = renderPrompt(promptTemplate, {
      character_name: activeCharacter.first_name,
      location_name: session.current_location_id,
      target_age: blueprint.metadata.target_age,
    });
    const aiMetadata = createAIRequestMetadata(req, {
      request_id: requestId,
      endpoint: "game-talk",
      action: "talk",
      game_id: gameId,
    });

    const aiProvider = getAIProvider();
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

    const newTime = session.time_remaining - 1;
    const isForcedEndgame = newTime <= 0;
    const nextMode = isForcedEndgame ? "accuse" : "talk";
    const eventType = isForcedEndgame ? "forced_endgame" : "talk";

    const { error: updateError } = await db
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
      logError("request.error", {
        reason: "session_update_failed",
        game_id: gameId,
      });
      return internalError("Failed to update session");
    }

    const nextSequence = await getNextSequence(db, gameId);
    await db.from("game_events").insert({
      session_id: gameId,
      sequence: nextSequence,
      event_type: eventType,
      actor: "system",
      payload: {
        role: "talk_start",
        character: activeCharacter.first_name,
        character_name: activeCharacter.first_name,
        location_name: session.current_location_id,
        context_version: "v1",
      },
      narration: talkStartOutput.narration,
    });

    return new Response(
      JSON.stringify({
        narration: talkStartOutput.narration,
        time_remaining: newTime,
        mode: nextMode,
        current_talk_character: isForcedEndgame
          ? null
          : activeCharacter.first_name,
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
