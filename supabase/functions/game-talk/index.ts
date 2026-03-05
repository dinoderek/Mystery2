import { createClient } from "../_shared/db.ts";
import { badRequest, internalError } from "../_shared/errors.ts";
import { validateTransition } from "../_shared/state-machine.ts";
import { getAIProvider } from "../_shared/ai-provider.ts";
import { BlueprintSchema } from "../_shared/blueprints/blueprint-schema.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405 });

  try {
    const body = await req.json();
    if (!body || !body.game_id || !body.character_name)
      return badRequest("Missing game_id or character_name");

    const { game_id, character_name } = body;
    const db = createClient();

    const { data: session, error: sessionError } = await db
      .from("game_sessions")
      .select("*")
      .eq("id", game_id)
      .single();
    if (sessionError || !session) return badRequest("Game session not found");

    validateTransition(session.mode, "talk");

    const { data: fileData, error: downloadError } = await db.storage
      .from("blueprints")
      .download(`${session.blueprint_id}.json`);
    if (downloadError) return internalError("Blueprint missing");
    const blueprint = BlueprintSchema.parse(JSON.parse(await fileData.text()));

    const currentLoc = session.current_location_id;
    const char = blueprint.world.characters.find(
      (c) => c.first_name === character_name && c.location === currentLoc,
    );
    if (!char)
      return badRequest(
        `Character ${character_name} not found in ${currentLoc}`,
      );

    const newTime = session.time_remaining - 1;
    let nextMode = "talk";
    let eventType = "talk";
    let aiPrompt = `The player approaches ${char.first_name} ${char.last_name}. They are ${char.personality}. They currently feel ${char.initial_attitude_towards_investigator}. Narrate their opening greeting.`;

    if (newTime <= 0) {
      nextMode = "accuse";
      eventType = "forced_endgame";
      aiPrompt +=
        " However, time has run out! Narrate that they cut the conversation short and the player must accuse someone now.";
    }

    const ai = getAIProvider();
    const narration = await ai.generateNarration(aiPrompt);

    const { error: updateError } = await db
      .from("game_sessions")
      .update({
        time_remaining: newTime,
        mode: nextMode,
        current_talk_character_id: newTime > 0 ? char.first_name : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", game_id);

    if (updateError) return internalError("Failed to update session");

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
      actor: char.first_name,
      payload: { character: char.first_name },
      narration: narration,
    });

    return new Response(
      JSON.stringify({
        narration,
        time_remaining: newTime,
        mode: nextMode,
        current_talk_character: newTime > 0 ? char.first_name : null,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    if (err.name === "BadRequestError") return badRequest(err.message);
    console.error(err);
    return internalError("Internal Server Error");
  }
});
