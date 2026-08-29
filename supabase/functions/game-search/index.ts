import type { EngineContext } from "../_shared/context.ts";
import { requireEngineContext } from "../_shared/context-supabase.ts";
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
import { createRequestLogger, withLogContext } from "../_shared/logging.ts";
import { parseSearchOutput } from "../_shared/ai-contracts.ts";
import {
  findLocationById,
  type BlueprintClue,
} from "../_shared/ai-context.ts";
import {
  buildDiscoveredClueIdSet,
  isClueUnlocked,
} from "../_shared/clue-discovery.ts";
import { tryGenerateForcedEndgame, insertForcedEndgameEvent } from "../_shared/forced-endgame.ts";
import { buildRoleRequest, resolveSearchRole } from "../_shared/role-request.ts";
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

export async function handle(
  req: Request,
  ctx: EngineContext,
): Promise<Response> {
  const logger = createRequestLogger(req, "game-search");
  const { requestId, log, logError } = logger;

  try {
    const body = await req.json();
    if (!body || !body.game_id) {
      log("request.invalid", { reason: "missing_game_id" });
      return badRequest("Missing game_id");
    }

    const gameId = String(body.game_id);
    const searchQuery: string | null =
      typeof body.search_query === "string" && body.search_query.trim().length > 0
        ? body.search_query.trim()
        : null;
    const narrationLogger = withLogContext(logger, { game_id: gameId });

    const session = await ctx.sessions.getById(gameId);

    if (!session) {
      log("request.invalid", { reason: "session_not_found", game_id: gameId });
      return badRequest("Game session not found");
    }
    validateTransition(session.mode, "search");

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

    const currentLocation = findLocationById(blueprint, session.current_location_id);
    if (!currentLocation) {
      logError("request.error", {
        reason: "current_location_missing_in_blueprint",
        game_id: gameId,
        location_id: session.current_location_id,
      });
      return internalError("Current location not found in blueprint");
    }

    const historyRows = await ctx.events.listBySession(gameId);

    // Collect all clue IDs (location-level + sub-location)
    const allCanonicalClueIds = collectAllLocationClueIds(currentLocation);
    const revealedClueIds = collectRevealedClueIds(
      historyRows ?? [],
      currentLocation.id,
      allCanonicalClueIds,
    );

    // Session-global discovered set, used to gate locked clues. A clue's
    // prerequisites may live in another location or character, so gating cannot
    // use the location-scoped revealed set.
    const discoveredGlobal = buildDiscoveredClueIdSet(historyRows ?? []);

    // For bare search: the next location-level clue that is both unrevealed AND
    // unlocked. Skipping locked clues prevents dead-ending (if clue[0] is gated
    // but clue[1] is open, bare search surfaces clue[1]).
    const nextClue = searchQuery === null
      ? (currentLocation.clues.find(
          (c) =>
            !revealedClueIds.includes(c.id) &&
            isClueUnlocked(c, discoveredGlobal),
        ) ?? null)
      : null;

    // Bare vs targeted is resolved in the shared layer so the eval harness
    // picks the same prompt (and the same word budget) for the same input.
    const promptKey = resolveSearchRole(searchQuery);

    const { prompt, context: aiContext } = await buildRoleRequest({
      role: promptKey,
      game_id: gameId,
      session,
      blueprint,
      location_id: currentLocation.id,
      revealed_clue_ids: revealedClueIds,
      discovered_clue_ids: [...discoveredGlobal],
      next_clue: nextClue,
      search_query: searchQuery,
      conversation_history: historyRows ?? [],
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

    // Capture the model now: a later forced-endgame generation would otherwise
    // overwrite the provider's resolvedModel before this event is persisted.
    const searchModel = aiProvider.resolvedModel;

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
        // Deterministic backstop: a clue whose prerequisites are not all
        // discovered cannot be revealed by search (search gates are hard — there
        // is no brilliance override here, unlike conversation).
        if (isClueUnlocked(clue, discoveredGlobal)) {
          validatedClueId = aiClueId;
          validatedClue = clue;
        } else {
          log("search.clue_locked", {
            game_id: gameId,
            ai_clue_id: aiClueId,
            requires: clue.requires?.clue_ids ?? [],
          });
        }
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
    let forcedModel: string | null = null;

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
      forcedModel = result.model;
      combinedParts = [...searchParts, ...forcedParts];
    }

    // Materialize the discovered-clues cache: union the existing set with any
    // newly revealed clue. Events remain the source of truth; this denormalized
    // column powers the notebook read path and fast gating reads.
    const existingDiscovered: string[] = Array.isArray(session.discovered_clues)
      ? session.discovered_clues
      : [];
    const discoveredClues = validatedClueId === null
      ? existingDiscovered
      : [...new Set([...existingDiscovered, validatedClueId])];

    try {
      await ctx.sessions.update(gameId, {
        time_remaining: newTime,
        mode: nextMode,
        current_talk_character_id: null,
        discovered_clues: discoveredClues,
        updated_at: new Date().toISOString(),
      });
    } catch {
      logError("request.error", {
        reason: "session_update_failed",
        game_id: gameId,
      });
      return internalError("Failed to update session");
    }

    const updatedRevealedClueIds = validatedClueId === null
      ? revealedClueIds
      : [...revealedClueIds, validatedClueId];

    const searchSequence = await insertNarrationEvent(ctx.events, {
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
        revealed_clue_ids: updatedRevealedClueIds,
        costs_turn: costsTurn,
        input_understood: searchOutput.input_understood,
        speaker: NARRATOR_SPEAKER,
      },
      narration_parts: searchParts,
      model: searchModel,
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
      await insertForcedEndgameEvent(ctx.events, {
        session_id: gameId,
        action: "search",
        action_sequence: searchSequence,
        payload: {
          location_id: currentLocation.id,
          location_name: currentLocation.name,
        },
        narration_parts: forcedParts,
        follow_up_prompt: followUpPrompt,
        model: forcedModel,
        time_before: session.time_remaining,
        time_after: newTime,
        resulting_mode: nextMode,
        logger: narrationLogger,
      });
    }

    // Notebook record(s) for any clue found this turn (search clues are never
    // off-script — search gating is hard).
    const discoveredThisTurn = validatedClue && validatedClueId
      ? [{
        id: validatedClueId,
        text: validatedClue.text,
        source: "search" as const,
        origin: {
          kind: "location" as const,
          location_id: currentLocation.id,
          location_name: currentLocation.name,
        },
        discovered_at: new Date().toISOString(),
        off_script: false,
      }]
      : [];

    return new Response(
      JSON.stringify({
        narration_parts: combinedParts,
        time_remaining: newTime,
        mode: nextMode,
        current_talk_character: null,
        follow_up_prompt: followUpPrompt,
        // Clue(s) revealed by this action, for the in-game notebook to merge
        // (rich records: thread membership, origin, off-script flag).
        revealed_clues: discoveredThisTurn,
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
}

serveWithCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const ctx = await requireEngineContext(req);
  if (ctx instanceof Response) return ctx;

  return handle(req, ctx);
});
