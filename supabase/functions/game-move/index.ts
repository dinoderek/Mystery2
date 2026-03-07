import { createClient } from "../_shared/db.ts";
import { badRequest, internalError } from "../_shared/errors.ts";
import { validateTransition } from "../_shared/state-machine.ts";
import { getAIProvider } from "../_shared/ai-provider.ts";
import { BlueprintSchema } from "../_shared/blueprints/blueprint-schema.ts";
import { selectLocationConversationHistory } from "../_shared/ai-context.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405 });

  try {
    const body = await req.json();
    if (!body || !body.game_id || !body.destination) {
      return badRequest("Missing game_id or destination");
    }

    const { game_id, destination } = body;
    const db = createClient();

    // Fetch session
    const { data: session, error: sessionError } = await db
      .from("game_sessions")
      .select("*")
      .eq("id", game_id)
      .single();

    if (sessionError || !session) return badRequest("Game session not found");

    validateTransition(session.mode, "move");

    // Fetch blueprint locations
    const { data: fileData, error: downloadError } = await db.storage
      .from("blueprints")
      .download(`${session.blueprint_id}.json`);
    if (downloadError) return internalError("Blueprint missing");
    const blueprintText = await fileData.text();
    const blueprint = BlueprintSchema.parse(JSON.parse(blueprintText));

    const destLoc = blueprint.world.locations.find(
      (l) => l.name === destination,
    );
    if (!destLoc) return badRequest("Invalid destination");

    let newTime = session.time_remaining - 1;
    let nextMode = session.mode;
    let eventType = "move";

    const { data: historyRows } = await db
      .from("game_events")
      .select("sequence,event_type,actor,narration,payload")
      .eq("session_id", game_id)
      .order("sequence", { ascending: true });
    const locationHistory = selectLocationConversationHistory(
      historyRows ?? [],
      destLoc.name,
    );
    const locationHistoryJson = JSON.stringify(locationHistory);

    let aiPrompt =
      `The player moves to ${destLoc.name}. Describe the new location concisely based on: ${destLoc.description}. Use all and only the interaction history tied to ${destLoc.name}: ${locationHistoryJson}.`;

    if (newTime <= 0) {
      nextMode = "accuse";
      eventType = "forced_endgame";
      aiPrompt =
        `The player moves to ${destLoc.name}. Time has run out! Narrate that the investigation is over and they must make an accusation now. Use all and only the interaction history tied to ${destLoc.name}: ${locationHistoryJson}.`;
    }

    const ai = getAIProvider();
    const narration = await ai.generateNarration(aiPrompt);

    // Update Session
    const { error: updateError } = await db
      .from("game_sessions")
      .update({
        current_location_id: destLoc.name,
        time_remaining: newTime,
        mode: nextMode,
        updated_at: new Date().toISOString(),
      })
      .eq("id", game_id);

    if (updateError) return internalError("Failed to update session");

    // Record Event
    const { data: events } = await db
      .from("game_events")
      .select("sequence")
      .eq("session_id", game_id)
      .order("sequence", { ascending: false })
      .limit(1);
    const nextSeq = events && events.length > 0 ? events[0].sequence + 1 : 1;

    await db.from("game_events").insert({
      session_id: game_id,
      sequence: nextSeq,
      event_type: eventType,
      actor: "system",
      payload: {
        destination,
        location_name: destLoc.name,
      },
      narration: narration,
    });

    const visible_characters = blueprint.world.characters
      .filter((c) => c.location === destLoc.name)
      .map((c) => ({ first_name: c.first_name, last_name: c.last_name }));

    return new Response(
      JSON.stringify({
        narration: narration,
        current_location: destLoc.name,
        visible_characters,
        time_remaining: newTime,
        mode: nextMode,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    if (err.name === "BadRequestError") return badRequest(err.message);
    console.error(err);
    return internalError("Internal Server Error");
  }
});
