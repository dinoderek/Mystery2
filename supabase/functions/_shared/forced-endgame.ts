import type { AIProvider } from "./ai-provider.ts";
import { createAIRequestMetadata } from "./ai-provider.ts";
import { aiRetriableError, RetriableAIError } from "./errors.ts";
import { parseAccusationStartOutput } from "./ai-contracts.ts";
import {
  buildAccusationStartContext,
  type BlueprintContext,
  type ConversationFragment,
  type SessionSnapshot,
} from "./ai-context.ts";
import { loadPromptTemplate, renderPrompt } from "./ai-prompts.ts";
import {
  createNarrationDiagnostics,
  createNarrationPart,
  insertNarrationEvent,
  type NarrationPart,
} from "./narration.ts";
import { NARRATOR_SPEAKER } from "./speaker.ts";
import type { LogWriter } from "./logging.ts";

export async function generateForcedAccusationStartNarration(input: {
  req: Request;
  request_id: string;
  endpoint: string;
  game_id: string;
  aiProvider: AIProvider;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  conversation_history: ConversationFragment[];
  scene_summary: string;
}): Promise<{
  narration: string;
  narration_parts: NarrationPart[];
  follow_up_prompt: string;
}> {
  const aiContext = buildAccusationStartContext({
    game_id: input.game_id,
    session: {
      ...input.session,
      mode: "accuse",
      current_talk_character_id: null,
    },
    blueprint: input.blueprint,
    forced_by_timeout: true,
    conversation_history: input.conversation_history,
  });

  const promptTemplate = await loadPromptTemplate("accusation_start");
  const prompt = renderPrompt(promptTemplate, {
    forced_context: input.scene_summary,
    target_age: input.blueprint.metadata.target_age,
  });
  const aiMetadata = createAIRequestMetadata(input.req, {
    request_id: input.request_id,
    endpoint: input.endpoint,
    action: "forced_endgame_start",
    game_id: input.game_id,
  });

  const output = await input.aiProvider.generateRoleOutput({
    role: "accusation_start",
    prompt,
    context: aiContext,
    parse: parseAccusationStartOutput,
    metadata: aiMetadata,
  });

  return {
    ...output,
    narration_parts: [createNarrationPart(output.narration, NARRATOR_SPEAKER)],
  };
}

/**
 * Generates forced endgame narration with standardised error handling.
 * Returns the AI output on success, or an error Response to return directly.
 */
export async function tryGenerateForcedEndgame(input: {
  req: Request;
  request_id: string;
  endpoint: string;
  game_id: string;
  aiProvider: AIProvider;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  conversation_history: ConversationFragment[];
  scene_summary: string;
  log: LogWriter["log"];
}): Promise<
  | { ok: true; follow_up_prompt: string; narration_parts: NarrationPart[] }
  | { ok: false; response: Response }
> {
  try {
    const output = await generateForcedAccusationStartNarration({
      req: input.req,
      request_id: input.request_id,
      endpoint: input.endpoint,
      game_id: input.game_id,
      aiProvider: input.aiProvider,
      session: input.session,
      blueprint: input.blueprint,
      conversation_history: input.conversation_history,
      scene_summary: input.scene_summary,
    });
    return {
      ok: true,
      follow_up_prompt: output.follow_up_prompt,
      narration_parts: output.narration_parts,
    };
  } catch (error) {
    if (error instanceof RetriableAIError) {
      input.log("request.ai_retriable", {
        game_id: input.game_id,
        action: "forced_endgame_start",
        code: error.details.code ?? null,
        status: error.details.status ?? null,
        error: error.message,
      });
      return { ok: false, response: aiRetriableError(error.message, error.details) };
    }
    input.log("request.ai_retriable", {
      game_id: input.game_id,
      action: "forced_endgame_start",
      code: "AI_INVALID_OUTPUT",
      error: "AI output validation failed",
    });
    return {
      ok: false,
      response: aiRetriableError("AI output validation failed", {
        code: "AI_INVALID_OUTPUT",
      }),
    };
  }
}

interface DatabaseClient {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        order: (
          column: string,
          options: { ascending: boolean },
        ) => {
          limit: (count: number) => Promise<{ data: Array<{ sequence: number }> | null }>;
        };
      };
    };
    insert: (
      values: Record<string, unknown> | Array<Record<string, unknown>>,
    ) => Promise<{ error?: { message?: string } | null }>;
  };
}

/**
 * Inserts the forced_endgame narration event and logs the timeout transition.
 * Call after the action's own narration event has been persisted.
 */
export async function insertForcedEndgameEvent(
  db: DatabaseClient,
  input: {
    session_id: string;
    action: string;
    action_sequence: number;
    payload: Record<string, unknown>;
    narration_parts: NarrationPart[];
    follow_up_prompt: string | null;
    time_before: number;
    time_after: number;
    resulting_mode: string;
    logger: LogWriter;
  },
): Promise<number> {
  const sequence = await insertNarrationEvent(db, {
    session_id: input.session_id,
    event_type: "forced_endgame",
    actor: "system",
    payload: {
      role: "accusation_start",
      ...input.payload,
      trigger: "timeout",
      follow_up_prompt: input.follow_up_prompt,
      speaker: NARRATOR_SPEAKER,
    },
    narration_parts: input.narration_parts,
    diagnostics: createNarrationDiagnostics({
      action: input.action,
      event_category: "forced_endgame",
      mode: "accuse",
      resulting_mode: "accuse",
      time_before: input.time_after,
      time_after: input.time_after,
      time_consumed: false,
      forced_endgame: true,
      trigger: "timeout",
      related_sequence: input.action_sequence,
    }),
    logger: input.logger,
  });

  input.logger.log("timeout.transition", {
    game_id: input.session_id,
    action: input.action,
    time_before: input.time_before,
    time_after: input.time_after,
    resulting_mode: input.resulting_mode,
    action_sequence: input.action_sequence,
    forced_endgame_sequence: sequence,
  });

  return sequence;
}
