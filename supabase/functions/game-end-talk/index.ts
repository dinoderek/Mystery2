import { createClient } from "../_shared/db.ts";
import { badRequest, internalError } from "../_shared/errors.ts";
import { validateTransition } from "../_shared/state-machine.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405 });

  try {
    const body = await req.json();
    if (!body || !body.game_id) return badRequest("Missing game_id");

    const { game_id } = body;
    const db = createClient();

    const { data: session, error: sessionError } = await db
      .from("game_sessions")
      .select("*")
      .eq("id", game_id)
      .single();
    if (sessionError || !session) return badRequest("Game session not found");

    // We allow ending talk from "talk" mode.
    validateTransition(session.mode, "end_talk");

    const { error: updateError } = await db
      .from("game_sessions")
      .update({
        mode: "explore",
        current_talk_character_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", game_id);

    if (updateError) return internalError("Failed to update session");

    // Optionally record an event, but the contract doesn't strictly say it's required for end_talk.
    // It's good for history though!
    const { data: events } = await db
      .from("game_events")
      .select("sequence")
      .eq("session_id", game_id)
      .order("sequence", { ascending: false })
      .limit(1);
    const nextSeq = events && events.length > 0 ? events[0].sequence + 1 : 1;

    const narration = `You end the conversation with ${session.current_talk_character_id}.`;
    await db.from("game_events").insert({
      session_id: game_id,
      sequence: nextSeq,
      event_type: "end_talk",
      actor: "system",
      narration: narration,
    });

    return new Response(
      JSON.stringify({
        narration,
        time_remaining: session.time_remaining,
        mode: "explore",
        current_talk_character: null,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    if (err.name === "BadRequestError") return badRequest(err.message);
    console.error(err);
    return internalError("Internal Server Error");
  }
});
