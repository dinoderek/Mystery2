import type { EngineContext } from "../context.ts";
import {
  aiRetriableError,
  badRequest,
  internalError,
  RetriableAIError,
} from "../errors.ts";
import { validateTransition } from "../state-machine.ts";
import {
  createAIRequestMetadata,
  createAIProviderFromProfile,
} from "../ai-provider.ts";
import { createRequestLogger, withLogContext } from "../logging.ts";
import { parseTalkConversationOutput } from "../ai-contracts.ts";
import { buildRoleRequest } from "../role-request.ts";
import {
  createNarrationDiagnostics,
  createNarrationPart,
  insertNarrationEvent,
} from "../narration.ts";
import {
  createCharacterSpeaker,
} from "../speaker.ts";

export async function handle(
  req: Request,
  ctx: EngineContext,
): Promise<Response> {
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

    const session = await ctx.sessions.getById(gameId);
    if (!session) {
      log("request.invalid", { reason: "session_not_found", game_id: gameId });
      return badRequest("Game session not found");
    }

    validateTransition(session.mode, "ask");
    if (!session.current_talk_character_id) {
      log("request.invalid", { reason: "no_active_talk_character", game_id: gameId });
      return badRequest("Not talking to anyone");
    }

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

    const blueprint = await ctx.content.loadBlueprint(session.blueprint_id, narrationLogger);
    if (!blueprint) {
      return internalError("Blueprint missing");
    }

    const activeCharacter = blueprint.world.characters.find(
      (character) => character.id === session.current_talk_character_id,
    );
    if (!activeCharacter) {
      return internalError("Character missing in blueprint");
    }

    const historyRows = await ctx.events.listBySession(gameId);

    const characterSpeaker = createCharacterSpeaker(activeCharacter.first_name);
    const { prompt, context: aiContext } = await buildRoleRequest({
      role: "talk_conversation",
      game_id: gameId,
      session,
      blueprint,
      character_id: activeCharacter.id,
      player_input: playerInput,
      location_id: session.current_location_id,
      conversation_history: historyRows ?? [],
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

    const validCharacterClueIds = new Set(
      activeCharacter.clues.map((c) => c.id),
    );
    const validatedRevealedClueIds = talkOutput.revealed_clue_ids.filter(
      (id) => validCharacterClueIds.has(id),
    );
    // Off-script grants are still real discoveries; only kept ids that actually
    // survived validation are flagged for the notebook badge.
    const validatedRevealedSet = new Set(validatedRevealedClueIds);
    const validatedOffScript = talkOutput.revealed_off_script.filter((id) =>
      validatedRevealedSet.has(id),
    );

    const narrationParts = [
      createNarrationPart(
        talkOutput.narration,
        characterSpeaker,
        null,
      ),
    ];

    // Materialize the discovered-clues cache (events stay the source of truth).
    const existingDiscovered: string[] = Array.isArray(session.discovered_clues)
      ? session.discovered_clues
      : [];
    const discoveredClues = validatedRevealedClueIds.length === 0
      ? existingDiscovered
      : [...new Set([...existingDiscovered, ...validatedRevealedClueIds])];

    try {
      await ctx.sessions.update(gameId, {
        discovered_clues: discoveredClues,
        updated_at: new Date().toISOString(),
      });
    } catch {
      return internalError("Failed to update session");
    }

    await insertNarrationEvent(ctx.events, {
      session_id: gameId,
      event_type: "ask",
      actor: "system",
      payload: {
        role: "talk_conversation",
        character_id: activeCharacter.id,
        character_name: activeCharacter.first_name,
        location_id: session.current_location_id,
        player_input: playerInput,
        character_portrait_image_id: activeCharacter.portrait_image_id ?? null,
        speaker: characterSpeaker,
        revealed_clue_ids: validatedRevealedClueIds,
        revealed_off_script: validatedOffScript,
        input_understood: talkOutput.input_understood,
      },
      narration_parts: narrationParts,
      model: aiProvider.resolvedModel,
      diagnostics: createNarrationDiagnostics({
        action: "ask",
        event_category: "ask",
        mode: "talk",
        resulting_mode: "talk",
        time_before: session.time_remaining,
        time_after: session.time_remaining,
        time_consumed: false,
        forced_endgame: false,
        trigger: "player",
      }),
      logger: narrationLogger,
    });

    const characterName =
      `${activeCharacter.first_name} ${activeCharacter.last_name}`.trim();
    const discoveredThisTurn = validatedRevealedClueIds.map((id) => ({
      id,
      text: activeCharacter.clues.find((c) => c.id === id)?.text ?? "",
      source: "talk" as const,
      origin: {
        kind: "character" as const,
        character_id: activeCharacter.id,
        character_name: characterName,
      },
      discovered_at: new Date().toISOString(),
      off_script: validatedOffScript.includes(id),
    }));

    return new Response(
      JSON.stringify({
        narration_parts: narrationParts,
        time_remaining: session.time_remaining,
        mode: "talk",
        current_talk_character: activeCharacter.id,
        // Clue(s) revealed by this action, for the in-game notebook to merge
        // (rich records: thread membership, origin, off-script flag).
        revealed_clues: discoveredThisTurn,
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
}
