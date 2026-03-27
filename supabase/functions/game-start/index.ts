import { requireAuth, isAuthError } from "../_shared/auth.ts";
import {
  asRetriableAIResponse,
  badRequest,
  internalError,
  notFound,
  RetriableAIError,
} from "../_shared/errors.ts";
import {
  createAIRequestMetadata,
  createAIProviderFromProfile,
} from "../_shared/ai-provider.ts";
import {
  getAIProfileById,
  getDefaultAIProfile,
} from "../_shared/ai-profile.ts";
import { buildGameStartPrompt } from "../_shared/ai-prompts.ts";
import { BlueprintV2Schema } from "../_shared/blueprints/blueprint-schema-v2.ts";
import { createRequestLogger } from "../_shared/logging.ts";
import { NARRATOR_SPEAKER } from "../_shared/speaker.ts";
import {
  createNarrationDiagnostics,
  createNarrationPart,
  insertNarrationEvent,
} from "../_shared/narration.ts";
import { serveWithCors } from "../_shared/cors.ts";

interface StartingKnowledge {
  mystery_summary: string;
  locations: Array<{ location_id: string; summary: string }>;
  characters: Array<{ character_id: string; summary: string }>;
}

interface WorldData {
  locations: Array<{ id: string; name: string }>;
  characters: Array<{
    id: string;
    first_name: string;
    last_name: string;
    location_id: string;
  }>;
}

function formatStartingKnowledgeBlock(
  sk: StartingKnowledge | undefined,
  world: WorldData,
): string | null {
  if (!sk) return null;

  const locationMap = new Map(world.locations.map((l) => [l.id, l.name]));
  const charsByLocation = new Map<string, string[]>();
  for (const c of world.characters) {
    const list = charsByLocation.get(c.location_id) ?? [];
    list.push(`${c.first_name} ${c.last_name}`);
    charsByLocation.set(c.location_id, list);
  }

  const lines: string[] = ["You already know:"];
  lines.push("");
  lines.push(`The mystery: ${sk.mystery_summary}`);

  if (sk.locations.length > 0) {
    lines.push("");
    lines.push("Locations:");
    for (const loc of sk.locations) {
      const name = locationMap.get(loc.location_id) ?? loc.location_id;
      const people = charsByLocation.get(loc.location_id);
      const peopleSuffix = people ? ` (${people.join(", ")})` : "";
      lines.push(`- ${name}: ${loc.summary}${peopleSuffix}`);
    }
  }

  if (sk.characters.length > 0) {
    lines.push("");
    lines.push("People:");
    for (const ch of sk.characters) {
      const character = world.characters.find((c) => c.id === ch.character_id);
      const name = character
        ? `${character.first_name} ${character.last_name}`
        : ch.character_id;
      lines.push(`- ${name}: ${ch.summary}`);
    }
  }

  return lines.join("\n");
}

serveWithCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const logger = createRequestLogger(req, "game-start");
  const { requestId, log, logError } = logger;

  try {
    // Authenticate user
    const authResult = await requireAuth(req);
    if (isAuthError(authResult)) return authResult;
    const { client: supabase, user: authUser } = authResult;

    const body = await req.json();
    if (!body || typeof body.blueprint_id !== "string") {
      log("request.invalid", { reason: "missing_or_invalid_blueprint_id" });
      return badRequest("Missing or invalid blueprint_id");
    }
    if (
      body.ai_profile !== undefined &&
      (typeof body.ai_profile !== "string" || body.ai_profile.trim().length === 0)
    ) {
      log("request.invalid", { reason: "invalid_ai_profile" });
      return badRequest("Invalid ai_profile");
    }

    const { blueprint_id } = body;
    const requestedAIProfile = typeof body.ai_profile === "string"
      ? body.ai_profile.trim()
      : null;

    const aiProfile = requestedAIProfile
      ? await getAIProfileById(requestedAIProfile)
      : await getDefaultAIProfile();

    if (requestedAIProfile && !aiProfile) {
      log("request.invalid", {
        reason: "unknown_ai_profile",
        ai_profile: requestedAIProfile,
      });
      return badRequest("Invalid ai_profile");
    }
    if (!aiProfile) {
      logError("request.error", { reason: "default_ai_profile_missing" });
      return internalError("No default AI profile configured");
    }

    // Prefer the canonical storage key, but retain a fallback scan for older buckets.
    let blueprintText: string | null = null;
    const { data: directBlueprintFile, error: directDownloadError } = await supabase.storage
      .from("blueprints")
      .download(`${blueprint_id}.json`);
    if (!directDownloadError && directBlueprintFile) {
      blueprintText = await directBlueprintFile.text();
    }

    if (!blueprintText) {
      const { data: files, error: listError } = await supabase.storage
        .from("blueprints")
        .list();
      if (listError) {
        logError("request.error", { reason: "storage_list_failed" });
        return internalError("Failed to access blueprints");
      }

      for (const file of files || []) {
        if (!file.name.endsWith(".json")) continue;

        const { data: fileData, error: downloadError } = await supabase.storage
          .from("blueprints")
          .download(file.name);
        if (downloadError) continue;

        const text = await fileData.text();
        try {
          const rawJson = JSON.parse(text);
          if (rawJson.id === blueprint_id) {
            blueprintText = text;
            break;
          }
        } catch (_error) {
          // Ignore malformed storage rows while scanning.
        }
      }
    }

    if (!blueprintText) {
      log("request.invalid", {
        reason: "blueprint_not_found",
        blueprint_id,
      });
      return notFound("Blueprint not found");
    }

    const rawBlueprint = JSON.parse(blueprintText);
    const blueprint = BlueprintV2Schema.parse(rawBlueprint);
    const startLocId = blueprint.world.starting_location_id;

    // Insert game_session (user_id from authenticated user)
    const { data: sessionData, error: sessionError } = await supabase
      .from("game_sessions")
      .insert({
        user_id: authUser.id,
        blueprint_id: blueprint.id,
        ai_profile_id: aiProfile.id,
        mode: "explore",
        current_location_id: startLocId,
        time_remaining: blueprint.metadata.time_budget,
      })
      .select("id")
      .single();

    if (sessionError) {
      logError("request.error", {
        reason: "session_create_failed",
        blueprint_id: blueprint.id,
        error: sessionError.message,
      });
      return internalError("Failed to create session");
    }

    const sessionId = sessionData.id;

    // Generate opening narration
    const aiProvider = createAIProviderFromProfile(aiProfile, {
      openrouterApiKey: aiProfile.openrouter_api_key,
    });
    const aiMetadata = createAIRequestMetadata(req, {
      request_id: requestId,
      endpoint: "game-start",
      action: "start",
      game_id: sessionId,
    });
    const narration = await aiProvider.generateNarration(
      buildGameStartPrompt({
        target_age: blueprint.metadata.target_age,
        premise: blueprint.narrative.premise,
      }),
      aiMetadata,
    );
    const narrationParts = [
      createNarrationPart(
        narration,
        NARRATOR_SPEAKER,
        blueprint.metadata.image_id ?? null,
      ),
    ];
    const startingKnowledgeBlock = formatStartingKnowledgeBlock(
      blueprint.narrative.starting_knowledge,
      blueprint.world,
    );
    if (startingKnowledgeBlock) {
      narrationParts.push(
        createNarrationPart(startingKnowledgeBlock, NARRATOR_SPEAKER),
      );
    }

    // Insert start event
    try {
      await insertNarrationEvent(supabase, {
        session_id: sessionId,
        event_type: "start",
        actor: "system",
        payload: {
          speaker: NARRATOR_SPEAKER,
          blueprint_image_id: blueprint.metadata.image_id ?? null,
          starting_knowledge: blueprint.narrative.starting_knowledge ?? null,
        },
        narration_parts: narrationParts,
        diagnostics: createNarrationDiagnostics({
          action: "start",
          event_category: "start",
          mode: "explore",
          resulting_mode: "explore",
          time_before: blueprint.metadata.time_budget,
          time_after: blueprint.metadata.time_budget,
          time_consumed: false,
          forced_endgame: false,
          trigger: "player",
        }),
        logger,
      });
    } catch (eventError) {
      logError("request.error", {
        reason: "event_insert_failed",
        game_id: sessionId,
        error: eventError instanceof Error ? eventError.message : String(eventError),
      });
      return internalError("Failed to record start event");
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
      time_remaining: blueprint.metadata.time_budget,
      location: startLocId,
      mode: "explore",
      current_talk_character: null,
    };

    return new Response(
      JSON.stringify({
        game_id: sessionId,
        state: gameState,
        narration_events: [
          {
            sequence: 1,
            event_type: "start",
            narration_parts: narrationParts,
            payload: {
              speaker: NARRATOR_SPEAKER,
              blueprint_image_id: blueprint.metadata.image_id ?? null,
              starting_knowledge: blueprint.narrative.starting_knowledge ?? null,
              diagnostics: createNarrationDiagnostics({
                action: "start",
                event_category: "start",
                mode: "explore",
                resulting_mode: "explore",
                time_before: blueprint.metadata.time_budget,
                time_after: blueprint.metadata.time_budget,
                time_consumed: false,
                forced_endgame: false,
                trigger: "player",
                related_sequence: 1,
              }),
            },
          },
        ],
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    if (err instanceof RetriableAIError) {
      log("request.ai_retriable", {
        code: err.details.code ?? null,
        status: err.details.status ?? null,
        error: err.message,
      });
      return asRetriableAIResponse(err) ?? internalError("Internal Server Error");
    }
    const aiResponse = asRetriableAIResponse(err);
    if (aiResponse) return aiResponse;
    logError("request.unhandled_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return internalError("Internal Server Error");
  }
});
