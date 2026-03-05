import { createClient } from "../_shared/db.ts";
import { badRequest, internalError } from "../_shared/errors.ts";
import { validateTransition } from "../_shared/state-machine.ts";
import { getAIProvider } from "../_shared/ai-provider.ts";
import { BlueprintSchema } from "../_shared/blueprints/blueprint-schema.ts";
import { generateClueId } from "../_shared/clue-ids.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405 });

  try {
    const body = await req.json();
    if (!body || !body.game_id) return badRequest("Missing game_id");

    const { game_id } = body;
    const db = createClient();

    // Fetch session
    const { data: session, error: sessionError } = await db
      .from("game_sessions")
      .select("*")
      .eq("id", game_id)
      .single();

    if (sessionError || !session) return badRequest("Game session not found");
    validateTransition(session.mode, "search");

    const { data: fileData, error: downloadError } = await db.storage
      .from("blueprints")
      .download(`${session.blueprint_id}.json`);
    if (downloadError) return internalError("Blueprint missing");
    const blueprint = BlueprintSchema.parse(JSON.parse(await fileData.text()));

    const currentLoc = blueprint.world.locations.find(
      (l) => l.name === session.current_location_id,
    );
    if (!currentLoc)
      return internalError("Current location not found in blueprint");

    const newTime = session.time_remaining - 1;
    let nextMode = session.mode;
    let discoveredClueId: string | null = null;
    let aiPrompt = `The player searches the ${currentLoc.name}. They find nothing useful. Narrate a brief failure.`;

    if (currentLoc.clues && currentLoc.clues.length > 0) {
      // Find first undiscovered clue
      const discoveredIds = new Set(session.discovered_clues || []);
      for (const clueText of currentLoc.clues) {
        const id = await generateClueId(clueText);
        if (!discoveredIds.has(id)) {
          discoveredClueId = id;
          aiPrompt = `The player searches the ${currentLoc.name}. They find a clue: "${clueText}". Narrate this discovery excitingly.`;
          break;
        }
      }
    }

    let eventType = "search";
    if (newTime <= 0) {
      nextMode = "accuse";
      eventType = "forced_endgame";
      aiPrompt +=
        " After searching, time has run out! Narrate that they must accuse now.";
    }

    const ai = getAIProvider();
    const narration = await ai.generateNarration(aiPrompt);

    const nextClues = discoveredClueId
      ? [...(session.discovered_clues || []), discoveredClueId]
      : session.discovered_clues;

    const { error: updateError } = await db
      .from("game_sessions")
      .update({
        time_remaining: newTime,
        mode: nextMode,
        discovered_clues: nextClues,
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
      actor: "system",
      narration: narration,
      clues_revealed: discoveredClueId ? [discoveredClueId] : [],
    });

    return new Response(
      JSON.stringify({
        narration,
        discovered_clue_id: discoveredClueId,
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
