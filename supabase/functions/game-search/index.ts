import { createClient } from "../_shared/db.ts";
import {
  aiRetriableError,
  badRequest,
  internalError,
  RetriableAIError,
} from "../_shared/errors.ts";
import { validateTransition } from "../_shared/state-machine.ts";
import { getAIProvider } from "../_shared/ai-provider.ts";
import { BlueprintSchema } from "../_shared/blueprints/blueprint-schema.ts";
import { parseSearchOutput } from "../_shared/ai-contracts.ts";
import { buildSearchContext } from "../_shared/ai-context.ts";
import { loadPromptTemplate, renderPrompt } from "../_shared/ai-prompts.ts";

async function getNextSequence(
  db: ReturnType<typeof createClient>,
  gameId: string,
): Promise<number> {
  const { data: events } = await db
    .from("game_events")
    .select("sequence")
    .eq("session_id", gameId)
    .order("sequence", { ascending: false })
    .limit(1);

  return events && events.length > 0 ? events[0].sequence + 1 : 1;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();
    if (!body || !body.game_id) {
      return badRequest("Missing game_id");
    }

    const gameId = String(body.game_id);
    const db = createClient();

    const { data: session, error: sessionError } = await db
      .from("game_sessions")
      .select("*")
      .eq("id", gameId)
      .single();

    if (sessionError || !session) {
      return badRequest("Game session not found");
    }
    validateTransition(session.mode, "search");

    const { data: fileData, error: downloadError } = await db.storage
      .from("blueprints")
      .download(`${session.blueprint_id}.json`);
    if (downloadError) {
      return internalError("Blueprint missing");
    }
    const blueprint = BlueprintSchema.parse(JSON.parse(await fileData.text()));

    const currentLocation = blueprint.world.locations.find(
      (location) => location.name === session.current_location_id,
    );
    if (!currentLocation) {
      return internalError("Current location not found in blueprint");
    }

    const { data: historyRows } = await db
      .from("game_events")
      .select("sequence,event_type,actor,narration,payload")
      .eq("session_id", gameId)
      .order("sequence", { ascending: true });

    const aiContext = buildSearchContext({
      game_id: gameId,
      session,
      blueprint,
      location_name: currentLocation.name,
      conversation_history: historyRows ?? [],
    });

    const promptTemplate = await loadPromptTemplate("search");
    const prompt = renderPrompt(promptTemplate, {
      location_name: currentLocation.name,
    });

    const aiProvider = getAIProvider();
    let searchOutput: ReturnType<typeof parseSearchOutput>;
    try {
      searchOutput = await aiProvider.generateRoleOutput({
        role: "search",
        prompt,
        context: aiContext,
        parse: parseSearchOutput,
      });
    } catch (error) {
      if (error instanceof RetriableAIError) {
        return aiRetriableError(error.message, error.details);
      }
      return aiRetriableError("AI output validation failed", {
        code: "AI_INVALID_OUTPUT",
      });
    }

    const newTime = session.time_remaining - 1;
    const isForcedEndgame = newTime <= 0;
    const nextMode = isForcedEndgame ? "accuse" : session.mode;
    const eventType = isForcedEndgame ? "forced_endgame" : "search";

    const { error: updateError } = await db
      .from("game_sessions")
      .update({
        time_remaining: newTime,
        mode: nextMode,
        updated_at: new Date().toISOString(),
      })
      .eq("id", gameId);
    if (updateError) {
      return internalError("Failed to update session");
    }

    const nextSequence = await getNextSequence(db, gameId);
    await db.from("game_events").insert({
      session_id: gameId,
      sequence: nextSequence,
      event_type: eventType,
      actor: "system",
      payload: {
        role: "search",
        location_name: currentLocation.name,
      },
      narration: searchOutput.narration,
    });

    return new Response(
      JSON.stringify({
        narration: searchOutput.narration,
        time_remaining: newTime,
        mode: nextMode,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "BadRequestError") {
      return badRequest(error.message);
    }
    console.error(error);
    return internalError("Internal Server Error");
  }
});
