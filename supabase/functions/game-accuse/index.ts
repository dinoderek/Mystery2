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
    if (!body || !body.game_id || !body.accused_character_id)
      return badRequest("Missing game_id or accused_character_id");

    const { game_id, accused_character_id } = body;
    const db = createClient();

    const { data: session, err: sessionError } = await db
      .from("game_sessions")
      .select("*")
      .eq("id", game_id)
      .single();
    if (sessionError || !session) return badRequest("Game session not found");

    validateTransition(session.mode, "accuse");

    const { data: fileData, error: downloadError } = await db.storage
      .from("blueprints")
      .download(`${session.blueprint_id}.json`);
    if (downloadError) return internalError("Blueprint missing");
    const blueprint = BlueprintSchema.parse(JSON.parse(await fileData.text()));

    const char = blueprint.world.characters.find(
      (c) =>
        c.first_name === accused_character_id ||
        `${c.first_name} ${c.last_name}` === accused_character_id,
    );
    if (!char) return badRequest("Character not found in blueprint");

    const isWin = char.is_culprit;

    let aiPrompt = `The player accuses ${char.first_name}. `;
    if (isWin) {
      aiPrompt += `This is CORRECT! Narrate the dramatic confession where they explain their true actions: ${char.mystery_action_real} and motive: ${char.motive}.`;
    } else {
      aiPrompt += `This is INCORRECT! Narrate their angry denial and how they explain their actual alibi: ${char.stated_alibi || char.mystery_action_real}.`;
    }

    const ai = getAIProvider();
    const narration = await ai.generateNarration(aiPrompt);

    const { error: updateError } = await db
      .from("game_sessions")
      .update({
        mode: "ended",
        current_talk_character_id: null,
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
      event_type: "accuse",
      actor: "system",
      payload: { accused: char.first_name, result: isWin ? "win" : "lose" },
      narration: narration,
    });

    return new Response(
      JSON.stringify({
        narration,
        result: isWin ? "win" : "lose",
        ground_truth: blueprint.ground_truth,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    if (err.name === "BadRequestError") return badRequest(err.message);
    console.error(err);
    return internalError("Internal Server Error");
  }
});
