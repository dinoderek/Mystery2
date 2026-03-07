import { createClient } from "../_shared/db.ts";
import { badRequest, notFound, internalError } from "../_shared/errors.ts";
import { BlueprintSchema } from "../_shared/blueprints/blueprint-schema.ts";
import { getAIProvider } from "../_shared/ai-provider.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();
    if (!body || typeof body.blueprint_id !== "string") {
      return badRequest("Missing or invalid blueprint_id");
    }

    const { blueprint_id } = body;
    const supabase = createClient();

    // Find blueprint in Storage
    const { data: files, error: listError } = await supabase.storage
      .from("blueprints")
      .list();
    if (listError) return internalError("Failed to access blueprints");

    let blueprintText: string | null = null;

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
      } catch (e) {
        // ignore invalid JSON
      }
    }

    if (!blueprintText) {
      return notFound("Blueprint not found");
    }

    const rawBlueprint = JSON.parse(blueprintText);
    const blueprint = BlueprintSchema.parse(rawBlueprint);
    const startLoc = blueprint.world.starting_location_id;

    // Insert game_session
    const { data: sessionData, error: sessionError } = await supabase
      .from("game_sessions")
      .insert({
        blueprint_id: blueprint.id,
        mode: "explore",
        current_location_id: startLoc,
        time_remaining: blueprint.metadata.time_budget,
      })
      .select("id")
      .single();

    if (sessionError) {
      console.error(sessionError);
      return internalError("Failed to create session");
    }

    const sessionId = sessionData.id;

    // Generate opening narration
    const aiProvider = getAIProvider();
    const narration = await aiProvider.generateNarration(
      blueprint.narrative.premise,
    );

    // Insert start event
    const { error: eventError } = await supabase.from("game_events").insert({
      session_id: sessionId,
      sequence: 1,
      event_type: "start",
      actor: "system",
      narration: narration,
    });

    if (eventError) {
      console.error(eventError);
      return internalError("Failed to record start event");
    }

    const gameState = {
      locations: blueprint.world.locations.map((l: any) => ({ name: l.name })),
      characters: blueprint.world.characters.map((c: any) => ({
        first_name: c.first_name,
        last_name: c.last_name,
        location_name: c.location,
      })),
      time_remaining: blueprint.metadata.time_budget,
      location: startLoc,
      mode: "explore",
      current_talk_character: null,
      narration: narration,
    };

    return new Response(
      JSON.stringify({
        game_id: sessionId,
        state: gameState,
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error(err);
    return internalError("Internal Server Error");
  }
});
