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
import { parseSearchOutput } from "../_shared/ai-contracts.ts";
import { buildSearchContext } from "../_shared/ai-context.ts";
import { generateForcedAccusationStartNarration } from "../_shared/forced-endgame.ts";
import { loadPromptTemplate, renderPrompt } from "../_shared/ai-prompts.ts";
import {
  createNarrationDiagnostics,
  createNarrationPart,
  insertNarrationEvent,
} from "../_shared/narration.ts";
import { NARRATOR_SPEAKER } from "../_shared/speaker.ts";
import { serveWithCors } from "../_shared/cors.ts";

function readPayloadField(
  payload: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!payload) {
    return null;
  }

  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readPayloadStringArray(
  payload: Record<string, unknown> | null | undefined,
  key: string,
): string[] {
  if (!payload) {
    return [];
  }

  const value = payload[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string =>
    typeof entry === "string" && entry.trim().length > 0
  );
}

function collectRevealedClues(
  historyRows: Array<{
    event_type: string;
    payload?: Record<string, unknown> | null;
  }>,
  locationName: string,
  canonicalClues: string[],
): string[] {
  const locationSearchEvents = historyRows.filter((entry) =>
    entry.event_type === "search" &&
    readPayloadField(entry.payload, "location_name") === locationName
  );

  const explicitRevealedClues: string[] = [];
  for (const event of locationSearchEvents) {
    const fromList = readPayloadStringArray(event.payload, "revealed_clues");
    for (const clue of fromList) {
      if (
        canonicalClues.includes(clue) &&
        !explicitRevealedClues.includes(clue)
      ) {
        explicitRevealedClues.push(clue);
      }
    }

    const singleClue = readPayloadField(event.payload, "revealed_clue_text");
    if (
      singleClue &&
      canonicalClues.includes(singleClue) &&
      !explicitRevealedClues.includes(singleClue)
    ) {
      explicitRevealedClues.push(singleClue);
    }
  }

  if (explicitRevealedClues.length > 0) {
    return explicitRevealedClues;
  }

  return canonicalClues.slice(0, Math.min(locationSearchEvents.length, canonicalClues.length));
}

serveWithCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const logger = createRequestLogger(req, "game-search");
  const { requestId, log, logError } = logger;

  try {
    const body = await req.json();
    if (!body || !body.game_id) {
      log("request.invalid", { reason: "missing_game_id" });
      return badRequest("Missing game_id");
    }

    // Authenticate user
    const authResult = await requireAuth(req);
    if (isAuthError(authResult)) return authResult;
    const { client: userClient } = authResult;

    const gameId = String(body.game_id);
    const narrationLogger = withLogContext(logger, { game_id: gameId });

    const { data: session, error: sessionError } = await userClient
      .from("game_sessions")
      .select("*")
      .eq("id", gameId)
      .single();

    if (sessionError || !session) {
      log("request.invalid", { reason: "session_not_found", game_id: gameId });
      return badRequest("Game session not found");
    }
    validateTransition(session.mode, "search");

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
    const blueprint = BlueprintSchema.parse(JSON.parse(await fileData.text()));

    const currentLocation = blueprint.world.locations.find(
      (location) => location.name === session.current_location_id,
    );
    if (!currentLocation) {
      logError("request.error", {
        reason: "current_location_missing_in_blueprint",
        game_id: gameId,
        location_name: session.current_location_id,
      });
      return internalError("Current location not found in blueprint");
    }

    const { data: historyRows } = await userClient
      .from("game_events")
      .select("sequence,event_type,actor,narration,payload")
      .eq("session_id", gameId)
      .order("sequence", { ascending: true });

    const newTime = Math.max(session.time_remaining - 1, 0);
    const isForcedEndgame = newTime === 0;
    const nextMode = isForcedEndgame ? "accuse" : session.mode;

    const aiContext = buildSearchContext({
      game_id: gameId,
      session,
      blueprint,
      location_name: currentLocation.name,
      revealed_clues: collectRevealedClues(
        historyRows ?? [],
        currentLocation.name,
        currentLocation.clues,
      ),
      next_clue: null,
      conversation_history: historyRows ?? [],
    });
    const revealedClues = aiContext.search_context?.revealed_clues ?? [];
    const nextClue = currentLocation.clues[revealedClues.length] ?? null;
    aiContext.search_context = aiContext.search_context
      ? {
          ...aiContext.search_context,
          next_clue: nextClue,
          has_more_clues: nextClue !== null,
        }
      : null;

    const promptTemplate = await loadPromptTemplate("search");
    const prompt = renderPrompt(promptTemplate, {
      location_name: currentLocation.name,
      target_age: blueprint.metadata.target_age,
    });
    const aiMetadata = createAIRequestMetadata(req, {
      request_id: requestId,
      endpoint: "game-search",
      action: "search",
      game_id: gameId,
    });

    let searchOutput: ReturnType<typeof parseSearchOutput>;
    try {
      searchOutput = await aiProvider.generateRoleOutput({
        role: "search",
        prompt,
        context: aiContext,
        parse: parseSearchOutput,
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

    const searchParts = [createNarrationPart(searchOutput.narration, NARRATOR_SPEAKER)];
    let combinedParts = [...searchParts];
    let followUpPrompt: string | null = null;
    let forcedParts: typeof searchParts = [];

    if (isForcedEndgame) {
      try {
        const forcedOutput = await generateForcedAccusationStartNarration({
          req,
          request_id: requestId,
          endpoint: "game-search",
          game_id: gameId,
          aiProvider,
          session: {
            ...session,
            time_remaining: newTime,
          },
          blueprint,
          conversation_history: historyRows ?? [],
          scene_summary: `The investigator just searched ${currentLocation.name}, and this action exhausted the remaining time.`,
        });
        followUpPrompt = forcedOutput.follow_up_prompt;
        forcedParts = forcedOutput.narration_parts;
        combinedParts = [...searchParts, ...forcedParts];
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
        current_talk_character_id: null,
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

    const searchSequence = await insertNarrationEvent(userClient, {
      session_id: gameId,
      event_type: "search",
      actor: "system",
      payload: {
        role: "search",
        location_name: currentLocation.name,
        revealed_clue_index: nextClue === null ? null : revealedClues.length,
        revealed_clue_text: nextClue,
        revealed_clues: nextClue === null ? revealedClues : [...revealedClues, nextClue],
        speaker: NARRATOR_SPEAKER,
      },
      narration_parts: searchParts,
      diagnostics: createNarrationDiagnostics({
        action: "search",
        event_category: "search",
        mode: session.mode,
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
          location_name: currentLocation.name,
          trigger: "timeout",
          follow_up_prompt: followUpPrompt,
          speaker: NARRATOR_SPEAKER,
        },
        narration_parts: forcedParts,
        diagnostics: createNarrationDiagnostics({
          action: "search",
          event_category: "forced_endgame",
          mode: "accuse",
          resulting_mode: "accuse",
          time_before: newTime,
          time_after: newTime,
          time_consumed: false,
          forced_endgame: true,
          trigger: "timeout",
          related_sequence: searchSequence,
        }),
        logger: narrationLogger,
      });

      log("timeout.transition", {
        game_id: gameId,
        action: "search",
        time_before: session.time_remaining,
        time_after: newTime,
        resulting_mode: nextMode,
        action_sequence: searchSequence,
        forced_endgame_sequence: forcedSequence,
      });
    }

    return new Response(
      JSON.stringify({
        narration_parts: combinedParts,
        time_remaining: newTime,
        mode: nextMode,
        current_talk_character: null,
        follow_up_prompt: followUpPrompt,
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
