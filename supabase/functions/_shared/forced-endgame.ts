import type { AIProvider } from "./ai-provider.ts";
import { createAIRequestMetadata } from "./ai-provider.ts";
import { parseAccusationStartOutput } from "./ai-contracts.ts";
import {
  buildAccusationStartContext,
  type BlueprintContext,
  type ConversationFragment,
  type SessionSnapshot,
} from "./ai-context.ts";
import { loadPromptTemplate, renderPrompt } from "./ai-prompts.ts";
import { createNarrationPart, type NarrationPart } from "./narration.ts";
import { NARRATOR_SPEAKER } from "./speaker.ts";

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
