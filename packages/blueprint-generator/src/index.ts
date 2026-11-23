import { BlueprintGenerationError } from "./errors.ts";
import { ClueGraphBriefSchema, type ClueGraphBrief } from "./clue-graph-brief.ts";
import { loadClueGraphGeneratorPrompt } from "./prompt.ts";

export { BlueprintGenerationError } from "./errors.ts";
export { ClueGraphBriefSchema, type ClueGraphBrief } from "./clue-graph-brief.ts";

/** What a clue-graph case's agent is told to do with its brief; the craft is in the prompt. */
export const CLUE_GRAPH_GENERATION_INSTRUCTIONS =
  "Write one clue-graph/2 case for story_brief to ./case.json, following ./CLAUDE.md. Set metadata.target_age to targetAge, metadata.size to size, and metadata.size_overrides to sizeOverrides when it is given.";

/**
 * The prompt for a clue-graph case: the clue-graph generator prompt alone, as
 * the system prompt, and the brief with its instructions. The agent writes the
 * case in a workspace, so there is no response schema.
 */
export async function buildClueGraphGenerationChatInput(
  storyBrief: ClueGraphBrief,
): Promise<{ systemPrompt: string; userMessageContent: string }> {
  const parsedBrief = ClueGraphBriefSchema.safeParse(storyBrief);
  if (!parsedBrief.success) {
    throw new BlueprintGenerationError("INVALID_STORY_BRIEF", "Story brief failed validation", {
      issues: parsedBrief.error.issues,
    });
  }
  return {
    systemPrompt: await loadClueGraphGeneratorPrompt(),
    userMessageContent: JSON.stringify({
      story_brief: parsedBrief.data,
      instructions: CLUE_GRAPH_GENERATION_INSTRUCTIONS,
    }),
  };
}
