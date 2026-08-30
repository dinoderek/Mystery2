import type { EngineContext } from "../context.ts";
import { badRequest, notFound, internalError } from "../errors.ts";
import { createRequestLogger } from "../logging.ts";
import { readNarrationEvent } from "../narration.ts";
import { buildDiscoveryRecords } from "../clue-discovery.ts";

export async function handle(
  req: Request,
  ctx: EngineContext,
): Promise<Response> {
  const logger = createRequestLogger(req, "game-get");
  const { log, logError } = logger;

  try {
    const url = new URL(req.url);
    const gameId = url.searchParams.get("game_id");

    if (!gameId) {
      log("request.invalid", { reason: "missing_game_id" });
      return badRequest("Missing game_id parameter");
    }

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

    const startingKnowledge = blueprint.narrative.starting_knowledge;
    const locationSummaries = new Map(
      (startingKnowledge?.locations ?? []).map((l) => [l.location_id, l.summary]),
    );
    const characterSummaries = new Map(
      (startingKnowledge?.characters ?? []).map((c) => [c.character_id, c.summary]),
    );
    // The notebook: discovered clues grouped by mini-mystery thread. Built from
    // event history (the source of truth) and joined against the blueprint.
    const discoveredClues = buildDiscoveryRecords(blueprint, events ?? []);

    const gameState = {
      mystery_summary: startingKnowledge?.mystery_summary ?? null,
      premise: blueprint.narrative.premise,
      locations: blueprint.world.locations.map((l) => ({
        id: l.id,
        name: l.name,
        summary: locationSummaries.get(l.id) ?? null,
      })),
      characters: blueprint.world.characters.map((c) => ({
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        location_id: c.location_id,
        sex: c.sex,
        summary: characterSummaries.get(c.id) ?? null,
      })),
      discovered_clues: discoveredClues,
      time_remaining: session.time_remaining,
      location: session.current_location_id,
      mode: session.mode,
      current_talk_character: session.current_talk_character_id || null,
    };

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
