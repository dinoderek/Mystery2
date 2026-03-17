import { requireAuth, isAuthError } from "../_shared/auth.ts";
import { badRequest, notFound, internalError } from "../_shared/errors.ts";
import {
  buildPublicWorld,
  createBlueprintRuntime,
  loadBlueprintFromStorage,
  loadStoredCharacterName,
  loadStoredLocationName,
  UnsupportedSessionStateError,
} from "../_shared/blueprints/runtime.ts";
import {
  createCharacterSpeaker,
  INVESTIGATOR_SPEAKER,
  NARRATOR_SPEAKER,
  readSpeaker,
  type Speaker,
} from "../_shared/speaker.ts";
import { serveWithCors } from "../_shared/cors.ts";

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

serveWithCors(async (req) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const authResult = await requireAuth(req);
    if (isAuthError(authResult)) {
      return authResult;
    }
    const { client: userClient } = authResult;

    const url = new URL(req.url);
    const gameId = url.searchParams.get("game_id");

    if (!gameId) {
      return badRequest("Missing game_id parameter");
    }

    const { data: session, error: sessionError } = await userClient
      .from("game_sessions")
      .select("*")
      .eq("id", gameId)
      .maybeSingle();

    if (sessionError) {
      return internalError("Database error");
    }
    if (!session) {
      return notFound("Game session not found");
    }

    const blueprint = await loadBlueprintFromStorage(userClient, session.blueprint_id);
    if (!blueprint) {
      return internalError("Original blueprint no longer available");
    }

    const runtime = createBlueprintRuntime(blueprint);

    const { data: events, error: eventsError } = await userClient
      .from("game_events")
      .select("*")
      .eq("session_id", gameId)
      .order("sequence", { ascending: true });

    if (eventsError) {
      return internalError("Failed to fetch game events");
    }

    const history = (events ?? []).map((event) => ({
      sequence: event.sequence,
      event_type: event.event_type,
      narration: event.narration,
      speaker: getEventSpeaker(event),
    }));

    const currentNarration =
      history.length > 0 ? history[history.length - 1].narration : "";
    const currentNarrationSpeaker =
      history.length > 0 ? history[history.length - 1].speaker : NARRATOR_SPEAKER;

    const publicWorld = buildPublicWorld(runtime);

    return new Response(
      JSON.stringify({
        state: {
          locations: publicWorld.locations,
          characters: publicWorld.characters,
          time_remaining: session.time_remaining,
          location: loadStoredLocationName(runtime, session.current_location_id),
          mode: session.mode,
          current_talk_character: loadStoredCharacterName(
            runtime,
            session.current_talk_character_id,
          ),
          narration: currentNarration,
          narration_speaker: currentNarrationSpeaker,
          history,
        },
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    if (error instanceof UnsupportedSessionStateError) {
      return badRequest("Session state is incompatible with Blueprint V2");
    }
    console.error(error);
    return internalError("Internal Server Error");
  }
});
