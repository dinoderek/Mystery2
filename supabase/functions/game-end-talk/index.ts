import { createClient } from "../_shared/db.ts";
import {
  aiRetriableError,
  badRequest,
  internalError,
  RetriableAIError,
} from "../_shared/errors.ts";
import { validateTransition } from "../_shared/state-machine.ts";
import { BlueprintSchema } from "../_shared/blueprints/blueprint-schema.ts";
import { getAIProvider } from "../_shared/ai-provider.ts";
import { parseTalkEndOutput } from "../_shared/ai-contracts.ts";
import { buildTalkEndContext } from "../_shared/ai-context.ts";
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

    validateTransition(session.mode, "end_talk");
    if (!session.current_talk_character_id) {
      return badRequest("No active conversation to end");
    }

    const { data: fileData, error: downloadError } = await db.storage
      .from("blueprints")
      .download(`${session.blueprint_id}.json`);
    if (downloadError) {
      return internalError("Blueprint missing");
    }

    const blueprint = BlueprintSchema.parse(JSON.parse(await fileData.text()));
    const { data: historyRows } = await db
      .from("game_events")
      .select("sequence,event_type,actor,narration,payload")
      .eq("session_id", gameId)
      .order("sequence", { ascending: true });

    const aiContext = buildTalkEndContext({
      game_id: gameId,
      session,
      blueprint,
      character_name: session.current_talk_character_id,
      location_name: session.current_location_id,
      conversation_history: historyRows ?? [],
    });

    const promptTemplate = await loadPromptTemplate("talk_end");
    const prompt = renderPrompt(promptTemplate, {
      character_name: session.current_talk_character_id,
    });

    const aiProvider = getAIProvider();
    let talkEndOutput: ReturnType<typeof parseTalkEndOutput>;
    try {
      talkEndOutput = await aiProvider.generateRoleOutput({
        role: "talk_end",
        prompt,
        context: aiContext,
        parse: parseTalkEndOutput,
      });
    } catch (error) {
      if (error instanceof RetriableAIError) {
        return aiRetriableError(error.message, error.details);
      }
      return aiRetriableError("AI output validation failed", {
        code: "AI_INVALID_OUTPUT",
      });
    }

    const { error: updateError } = await db
      .from("game_sessions")
      .update({
        mode: "explore",
        current_talk_character_id: null,
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
      event_type: "end_talk",
      actor: "system",
      payload: {
        role: "talk_end",
        character: session.current_talk_character_id,
        character_name: session.current_talk_character_id,
        location_name: session.current_location_id,
      },
      narration: talkEndOutput.narration,
    });

    return new Response(
      JSON.stringify({
        narration: talkEndOutput.narration,
        time_remaining: session.time_remaining,
        mode: "explore",
        current_talk_character: null,
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
