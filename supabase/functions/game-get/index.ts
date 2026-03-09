import { requireAuth, isAuthError } from "../_shared/auth.ts";
import { badRequest, notFound, internalError } from "../_shared/errors.ts";
import { BlueprintSchema } from "../_shared/blueprints/blueprint-schema.ts";
import {
  createCharacterSpeaker,
  INVESTIGATOR_SPEAKER,
  NARRATOR_SPEAKER,
  readSpeaker,
  type Speaker,
} from "../_shared/speaker.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getFallbackSpeaker(event: {
  actor: string;
  event_type: string;
  payload: unknown;
}): Speaker {
  if (event.event_type === "ask" && isRecord(event.payload)) {
    const characterName = event.payload.character_name;
    if (typeof characterName === "string" && characterName.length > 0) {
      return createCharacterSpeaker(characterName);
    }
  }

  if (event.actor === "player") {
    return INVESTIGATOR_SPEAKER;
  }

  return NARRATOR_SPEAKER;
}

function getEventSpeaker(event: {
  actor: string;
  event_type: string;
  payload: unknown;
}): Speaker {
  if (isRecord(event.payload)) {
    return readSpeaker(event.payload.speaker, getFallbackSpeaker(event));
  }

  return getFallbackSpeaker(event);
}

Deno.serve(async (req) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Authenticate user
    const authResult = await requireAuth(req);
    if (isAuthError(authResult)) return authResult;
    const { client: userClient } = authResult;

    const url = new URL(req.url);
    const gameId = url.searchParams.get("game_id");

    if (!gameId) {
      return badRequest("Missing game_id parameter");
    }

    // Fetch session
    const { data: session, error: sessionError } = await userClient
      .from("game_sessions")
      .select("*")
      .eq("id", gameId)
      .maybeSingle();

    if (sessionError) return internalError("Database error");
    if (!session) return notFound("Game session not found");

    // Fetch blueprint to hydrate static world details
    const { data: files, error: listError } = await userClient.storage
      .from("blueprints")
      .list();
    if (listError) return internalError("Failed to access blueprints");

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
      return internalError("Original blueprint no longer available");
    }
    const blueprint = BlueprintSchema.parse(JSON.parse(blueprintText));

    // Fetch events for history
    const { data: events, error: eventsError } = await userClient
      .from("game_events")
      .select("*")
      .eq("session_id", gameId)
      .order("sequence", { ascending: true });

    if (eventsError) {
      return internalError("Failed to fetch game events");
    }

    const history = (events ?? []).map((e) => ({
      sequence: e.sequence,
      event_type: e.event_type,
      narration: e.narration,
      speaker: getEventSpeaker(e),
    }));

    // Most recent event narration
    const currentNarration =
      history.length > 0 ? history[history.length - 1].narration : "";
    const currentNarrationSpeaker =
      history.length > 0 ? history[history.length - 1].speaker : NARRATOR_SPEAKER;

    const gameState = {
      locations: blueprint.world.locations.map((l) => ({ name: l.name })),
      characters: blueprint.world.characters.map((c) => ({
        first_name: c.first_name,
        last_name: c.last_name,
        location_name: c.location,
      })),
      time_remaining: session.time_remaining,
      location: session.current_location_id,
      mode: session.mode,
      current_talk_character: session.current_talk_character_id || null,
      narration: currentNarration,
      narration_speaker: currentNarrationSpeaker,
      history: history,
    };

    return new Response(JSON.stringify({ state: gameState }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return internalError("Internal Server Error");
  }
});
