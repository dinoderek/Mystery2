import { GameGetRequestSchema } from "../../../shared/src/mystery-api-contracts.ts";
import type { EngineContext } from "../context.ts";
import { notFound, internalError } from "../errors.ts";
import { createRequestLogger } from "../logging.ts";
import { readQueryRequest } from "../request.ts";
import { readNarrationEvent } from "../narration.ts";
import { buildDiscoveryRecords } from "../clue-discovery.ts";
import { buildGameState } from "../game-state-view.ts";

export async function handle(
  req: Request,
  ctx: EngineContext,
): Promise<Response> {
  const logger = createRequestLogger(req, "game-get");
  const { log, logError } = logger;

  try {
    const read = readQueryRequest(req, GameGetRequestSchema, logger);
    if (!read.ok) return read.response;
    const gameId = read.data.game_id;

    // Fetch session
    let session;
    try {
      session = await ctx.sessions.getById(gameId);
    } catch {
      logError("request.error", { reason: "session_fetch_failed", game_id: gameId });
      return internalError("Database error");
    }

    if (!session) {
      log("request.invalid", { reason: "session_not_found", game_id: gameId });
      return notFound("Game session not found");
    }

    // Fetch blueprint to hydrate static world details
    let blueprint;
    try {
      blueprint = await ctx.content.loadBlueprint(session.blueprint_id, logger);
    } catch {
      logError("request.error", { reason: "storage_list_failed", game_id: gameId });
      return internalError("Failed to access blueprints");
    }

    if (!blueprint) {
      logError("request.error", {
        reason: "blueprint_missing",
        game_id: gameId,
        blueprint_id: session.blueprint_id,
      });
      return internalError("Original blueprint no longer available");
    }

    // Fetch events for history
    let events;
    try {
      events = await ctx.events.listBySession(gameId);
    } catch {
      logError("request.error", { reason: "events_fetch_failed", game_id: gameId });
      return internalError("Failed to fetch game events");
    }

    const narrationEvents = (events ?? []).map((event) => readNarrationEvent(event));
    if (narrationEvents.some((event) => event.narration_parts.length === 0)) {
      logError("request.error", {
        reason: "transcript_load_failed",
        game_id: gameId,
        events_loaded: narrationEvents.length,
      });
      return internalError("Failed to load transcript", {
        recovery: "Return to the mystery list and reopen the case.",
      });
    }

    // The notebook: discovered clues grouped by mini-mystery thread. Built from
    // event history (the source of truth) and joined against the blueprint.
    const gameState = buildGameState(blueprint, {
      discovered_clues: buildDiscoveryRecords(blueprint, events ?? []),
      time_remaining: session.time_remaining,
      location: session.current_location_id,
      mode: session.mode,
      current_talk_character: session.current_talk_character_id || null,
    });

    return new Response(JSON.stringify({
      blueprint_id: session.blueprint_id,
      state: gameState,
      narration_events: narrationEvents,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    logError("request.unhandled_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return internalError("Internal Server Error");
  }
}
