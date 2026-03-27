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
import { BlueprintV2Schema } from "../_shared/blueprints/blueprint-schema-v2.ts";
import { parseSearchOutput, type AIPromptKey } from "../_shared/ai-contracts.ts";
import {
  buildSearchContext,
  findLocationById,
  type BlueprintClue,
} from "../_shared/ai-context.ts";
import { tryGenerateForcedEndgame, insertForcedEndgameEvent } from "../_shared/forced-endgame.ts";
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

/** Collect all canonical clue IDs for a location, including sub-location clues. */
function collectAllLocationClueIds(
  location: { clues: BlueprintClue[]; sub_locations?: Array<{ clues: BlueprintClue[] }> },
): string[] {
  const ids = location.clues.map((c) => c.id);
  for (const sl of location.sub_locations ?? []) {
    for (const c of sl.clues) {
      ids.push(c.id);
    }
  }
  return ids;
}

function collectRevealedClueIds(
  historyRows: Array<{
    event_type: string;
    payload?: Record<string, unknown> | null;
  }>,
  locationId: string,
  allCanonicalClueIds: string[],
): string[] {
  const locationSearchEvents = historyRows.filter((entry) =>
    entry.event_type === "search" &&
    (readPayloadField(entry.payload, "location_id") === locationId ||
     readPayloadField(entry.payload, "location_name") === locationId)
  );

  const canonicalSet = new Set(allCanonicalClueIds);
  const explicitRevealedIds: string[] = [];

  for (const event of locationSearchEvents) {
    // Try ID-based tracking first (V2 events)
    const fromIds = readPayloadStringArray(event.payload, "revealed_clue_ids");
    for (const clueId of fromIds) {
      if (
        canonicalSet.has(clueId) &&
        !explicitRevealedIds.includes(clueId)
      ) {
        explicitRevealedIds.push(clueId);
      }
    }

    const singleId = readPayloadField(event.payload, "revealed_clue_id");
    if (
      singleId &&
      canonicalSet.has(singleId) &&
      !explicitRevealedIds.includes(singleId)
    ) {
      explicitRevealedIds.push(singleId);
    }
  }

  if (explicitRevealedIds.length > 0) {
    return explicitRevealedIds;
  }

  // Fallback: infer from event count (location-level clues only, for legacy compat)
  const locationLevelIds = allCanonicalClueIds.slice(0, locationSearchEvents.length);
  return locationLevelIds;
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
    const searchQuery: string | null =
      typeof body.search_query === "string" && body.search_query.trim().length > 0
        ? body.search_query.trim()
        : null;
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
    const blueprint = BlueprintV2Schema.parse(JSON.parse(await fileData.text()));

    const currentLocation = findLocationById(blueprint, session.current_location_id);
    if (!currentLocation) {
      logError("request.error", {
        reason: "current_location_missing_in_blueprint",
        game_id: gameId,
        location_id: session.current_location_id,
      });
      return internalError("Current location not found in blueprint");
    }

    const { data: historyRows } = await userClient
      .from("game_events")
      .select("sequence,event_type,actor,narration,payload")
      .eq("session_id", gameId)
      .order("sequence", { ascending: true });

    // Collect all clue IDs (location-level + sub-location)
    const allCanonicalClueIds = collectAllLocationClueIds(currentLocation);
    const revealedClueIds = collectRevealedClueIds(
      historyRows ?? [],
      currentLocation.id,
      allCanonicalClueIds,
    );

    // For bare search: next location-level clue in sequence
    const locationLevelRevealed = revealedClueIds.filter((id) =>
      currentLocation.clues.some((c) => c.id === id),
    );
    const nextClue = searchQuery === null
      ? (currentLocation.clues[locationLevelRevealed.length] ?? null)
      : null;

    // Choose prompt based on search type
    const promptKey: AIPromptKey = searchQuery ? "search_targeted" : "search_bare";

    const aiContext = buildSearchContext({
      game_id: gameId,
      session,
      blueprint,
      location_id: currentLocation.id,
      revealed_clue_ids: revealedClueIds,
      next_clue: nextClue,
      search_query: searchQuery,
      conversation_history: historyRows ?? [],
    });

    const promptTemplate = await loadPromptTemplate(promptKey);
    const prompt = renderPrompt(promptTemplate, {
      location_name: currentLocation.name,
      target_age: blueprint.metadata.target_age,
      search_query: searchQuery ?? "",
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

    // Validate AI's revealed_clue_id
    const allClueMap = new Map<string, BlueprintClue>();
    for (const c of currentLocation.clues) allClueMap.set(c.id, c);
    for (const sl of currentLocation.sub_locations ?? []) {
      for (const c of sl.clues) allClueMap.set(c.id, c);
    }

    let validatedClueId: string | null = null;
    let validatedClue: BlueprintClue | null = null;
    const aiClueId = searchOutput.revealed_clue_id;
    if (aiClueId !== null) {
      const clue = allClueMap.get(aiClueId);
      if (clue && !revealedClueIds.includes(aiClueId)) {
        validatedClueId = aiClueId;
        validatedClue = clue;
      } else {
        log("search.clue_validation_failed", {
          game_id: gameId,
          ai_clue_id: aiClueId,
          exists: !!clue,
          already_revealed: revealedClueIds.includes(aiClueId),
        });
      }
    }

    // Turn cost resolution
    const costsTurn = searchQuery === null      // bare search always costs
      || validatedClueId !== null               // clue found always costs
      || searchOutput.costs_turn;               // AI decides for empty targeted search

    const newTime = costsTurn
      ? Math.max(session.time_remaining - 1, 0)
      : session.time_remaining;
    const isForcedEndgame = costsTurn && newTime === 0;
    const nextMode = isForcedEndgame ? "accuse" : session.mode;

    const searchParts = [createNarrationPart(searchOutput.narration, NARRATOR_SPEAKER)];
    let combinedParts = [...searchParts];
    let followUpPrompt: string | null = null;
    let forcedParts: typeof searchParts = [];

    if (isForcedEndgame) {
      const result = await tryGenerateForcedEndgame({
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
        log,
      });
      if (!result.ok) return result.response;
      followUpPrompt = result.follow_up_prompt;
      forcedParts = result.narration_parts;
      combinedParts = [...searchParts, ...forcedParts];
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

    const updatedRevealedClueIds = validatedClueId === null
      ? revealedClueIds
      : [...revealedClueIds, validatedClueId];

    const searchSequence = await insertNarrationEvent(userClient, {
      session_id: gameId,
      event_type: "search",
      actor: "system",
      payload: {
        role: "search",
        location_id: currentLocation.id,
        location_name: currentLocation.name,
        search_query: searchQuery,
        revealed_clue_id: validatedClueId,
        revealed_clue_text: validatedClue?.text ?? null,
        revealed_clue_role: validatedClue?.role ?? null,
        revealed_clue_ids: updatedRevealedClueIds,
        costs_turn: costsTurn,
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
        time_consumed: costsTurn,
        forced_endgame: isForcedEndgame,
        trigger: "player",
      }),
      logger: narrationLogger,
    });

    if (isForcedEndgame) {
      await insertForcedEndgameEvent(userClient, {
        session_id: gameId,
        action: "search",
        action_sequence: searchSequence,
        payload: {
          location_id: currentLocation.id,
          location_name: currentLocation.name,
        },
        narration_parts: forcedParts,
        follow_up_prompt: followUpPrompt,
        time_before: session.time_remaining,
        time_after: newTime,
        resulting_mode: nextMode,
        logger: narrationLogger,
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
