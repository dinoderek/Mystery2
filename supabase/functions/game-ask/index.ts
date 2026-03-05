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
    if (!body || !body.game_id || !body.clue_id)
      return badRequest("Missing game_id or clue_id");

    const { game_id, clue_id } = body;
    const db = createClient();

    const { data: session, error: sessionError } = await db
      .from("game_sessions")
      .select("*")
      .eq("id", game_id)
      .single();
    if (sessionError || !session) return badRequest("Game session not found");

    validateTransition(session.mode, "ask");
    if (!session.current_talk_character_id)
      return badRequest("Not talking to anyone");

    const discoveredClues = session.discovered_clues || [];
    if (!discoveredClues.includes(clue_id))
      return badRequest("Clue not discovered yet");

    const { data: fileData, error: downloadError } = await db.storage
      .from("blueprints")
      .download(`${session.blueprint_id}.json`);
    if (downloadError) return internalError("Blueprint missing");
    const blueprint = BlueprintSchema.parse(JSON.parse(await fileData.text()));

    const char = blueprint.world.characters.find(
      (c) => c.first_name === session.current_talk_character_id,
    );
    if (!char) return internalError("Character missing in blueprint");

    // Reconstruct clue text by rehashing blueprint clues
    let clueText = "an unknown clue";
    const allClueTexts = [
      ...blueprint.narrative.starting_knowledge,
      ...blueprint.world.locations.flatMap((l) => l.clues || []),
    ];
    for (const text of allClueTexts) {
      if ((await generateClueId(text)) === clue_id) {
        clueText = text;
        break;
      }
    }

    const newTime = session.time_remaining - 1;
    let nextMode = "talk";
    let eventType = "ask";

    let aiPrompt = `The player asks ${char.first_name} about: "${clueText}". Narrate their response based on their personality (${char.personality}) and knowledge.`;

    // Check if character knows about this clue specifically to reveal a new clue?
    // The design says asking characters reveals THEIR knowledge. If their knowledge matches the clue, they might share it.
    // For simplicity, MockAI just returns a string.

    let discoveredClueId: string | null = null;
    if (char.knowledge && char.knowledge.length > 0) {
      // If they have knowledge, reveal the first one they haven't revealed yet?
      // Just for MVP, reveal the first knowledge fact if not already known.
      for (const k of char.knowledge) {
        const kId = await generateClueId(k);
        if (!discoveredClues.includes(kId)) {
          discoveredClueId = kId;
          aiPrompt += ` They also reveal a new clue: "${k}".`;
          break;
        }
      }
    }

    if (newTime <= 0) {
      nextMode = "accuse";
      eventType = "forced_endgame";
      aiPrompt +=
        " After answering, time has run out! Narrate that the player must accuse someone immediately.";
    }

    const ai = getAIProvider();
    const narration = await ai.generateNarration(aiPrompt);

    const nextClues = discoveredClueId
      ? [...discoveredClues, discoveredClueId]
      : discoveredClues;

    const { error: updateError } = await db
      .from("game_sessions")
      .update({
        time_remaining: newTime,
        mode: nextMode,
        discovered_clues: nextClues,
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
      payload: { clue_id, asked_about: clueText },
      narration: narration,
      clues_revealed: discoveredClueId ? [discoveredClueId] : [],
    });

    return new Response(
      JSON.stringify({
        narration,
        discovered_clue_id: discoveredClueId,
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
