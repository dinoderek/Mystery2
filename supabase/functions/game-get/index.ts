import { requireAuth, isAuthError } from "../_shared/auth.ts";
import { badRequest, notFound, internalError } from "../_shared/errors.ts";
import { BlueprintV2Schema } from "../_shared/blueprints/blueprint-schema-v2.ts";
import { createRequestLogger } from "../_shared/logging.ts";
import { readNarrationEvent } from "../_shared/narration.ts";
import { serveWithCors } from "../_shared/cors.ts";

serveWithCors(async (req) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }
  const logger = createRequestLogger(req, "game-get");
  const { log, logError } = logger;

  try {
    // Authenticate user
    const authResult = await requireAuth(req);
    if (isAuthError(authResult)) return authResult;
    const { client: userClient } = authResult;

    const url = new URL(req.url);
    const gameId = url.searchParams.get("game_id");

    if (!gameId) {
      log("request.invalid", { reason: "missing_game_id" });
      return badRequest("Missing game_id parameter");
    }

    // Fetch session
    const { data: session, error: sessionError } = await userClient
      .from("game_sessions")
      .select("*")
      .eq("id", gameId)
      .maybeSingle();

    if (sessionError) {
      logError("request.error", { reason: "session_fetch_failed", game_id: gameId });
      return internalError("Database error");
    }
    if (!session) {
      log("request.invalid", { reason: "session_not_found", game_id: gameId });
      return notFound("Game session not found");
    }

    // Fetch blueprint to hydrate static world details
    const { data: files, error: listError } = await userClient.storage
      .from("blueprints")
      .list();
    if (listError) {
      logError("request.error", { reason: "storage_list_failed", game_id: gameId });
      return internalError("Failed to access blueprints");
    }

    let blueprintText: string | null = null;

    for (const file of files || []) {
      if (!file.name.endsWith(".json")) continue;
      const { data: fileData, error: downloadError } = await userClient.storage
        .from("blueprints")
        .download(file.name);
      if (downloadError) continue;
      const text = await fileData.text();
      try {
        const rawJson = JSON.parse(text);
        if (rawJson.id === session.blueprint_id) {
          blueprintText = text;
          break;
        }
      } catch (e) {
        // ignore
      }
    }

    if (!blueprintText) {
      logError("request.error", {
        reason: "blueprint_missing",
        game_id: gameId,
        blueprint_id: session.blueprint_id,
      });
      return internalError("Original blueprint no longer available");
    }
    const blueprint = BlueprintV2Schema.parse(JSON.parse(blueprintText));

    // Fetch events for history
    const { data: events, error: eventsError } = await userClient
      .from("game_events")
      .select("sequence,event_type,actor,narration,payload,narration_parts,created_at")
      .eq("session_id", gameId)
      .order("sequence", { ascending: true });

    if (eventsError) {
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

    const gameState = {
      locations: blueprint.world.locations.map((l) => ({
        id: l.id,
        name: l.name,
      })),
      characters: blueprint.world.characters.map((c) => ({
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        location_id: c.location_id,
        sex: c.sex,
      })),
      time_remaining: session.time_remaining,
      location: session.current_location_id,
      mode: session.mode,
      current_talk_character: session.current_talk_character_id || null,
    };

    return new Response(JSON.stringify({
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
});
