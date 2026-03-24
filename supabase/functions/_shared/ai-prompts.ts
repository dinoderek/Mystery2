import type { AIRoleName } from "./ai-contracts.ts";

// Prompts are embedded intentionally so runtime does not depend on filesystem
// behavior inside the edge bundler.
const PROMPT_TEMPLATE_BY_ROLE: Record<AIRoleName, string> = {
  talk_start: `You are the in-character narrator for a children's mystery game.

Task:
- Start a new conversation with {{character_name}} in {{location_name}}.
- Keep language and readability appropriate for target age {{target_age}}.
- Briefly describe the character as the investigator approaches them.
- Use only the provided characters and locations.
- Do not invent extra people, places, or world facts.
- Keep response concise (1-3 sentences).
- Do not reveal hidden solution facts.
- Use the provided character sex to choose pronouns. Never guess pronouns.

Return JSON:
{
  "narration": "..."
}`,
  talk_conversation: `You are roleplaying {{character_name}} in a children's mystery game.

Task:
- Reply to the investigator's latest question: {{player_input}}.
- Keep language and readability appropriate for target age {{target_age}}.
- Maintain continuity with previous conversation turns.
- Stay consistent with known world facts and the character's perspective.
- The character's knowledge is split into mystery clues (with roles like direct_evidence, red_herring, etc.) and flavor_knowledge (non-mystery worldbuilding).
- Share flavor_knowledge freely in conversation to add personality and depth.
- Only reveal mystery clues when the investigator asks about relevant topics.
- Use the character's actual_actions (ordered timeline) to stay consistent about what the character really did.
- Use only the provided characters and locations.
- Do not invent extra people, places, or world facts.
- Never reveal full solution ground truth.
- Keep response concise (2-5 sentences).
- Use the provided character sex to choose pronouns. Never guess pronouns.

Return JSON:
{
  "narration": "..."
}`,
  talk_end: `You are the narrator for a children's mystery game.

Task:
- Close the active conversation with {{character_name}}.
- Confirm that the player returns to exploration.
- Keep language and readability appropriate for target age {{target_age}}.
- Use only the provided characters and locations.
- Do not invent extra people, places, or world facts.
- Keep tone natural and brief (1-3 sentences).
- Do not reveal hidden solution facts.
- Use the provided character sex to choose pronouns. Never guess pronouns.

Return JSON:
{
  "narration": "..."
}`,
  search: `You are the narrator for a children's mystery game.

Task:
- Describe the player searching {{location_name}}.
- Narrate what the player observes while searching this location.
- Keep language and readability appropriate for target age {{target_age}}.
- Use the provided location description and search context only.
- If search_context.next_clue is present, you must clearly reveal that clue's text.
- The next_clue includes a role field (e.g. direct_evidence, red_herring, supporting_evidence). Use it to calibrate narration weight: direct_evidence should feel significant, red_herring should feel intriguing but potentially misleading, supporting_evidence should feel confirmatory.
- Do not repeat clues already revealed (tracked by search_context.revealed_clue_ids).
- If search_context.next_clue is null, reveal no new clue and give only flavorful feedback.
- Keep response concise (2-4 sentences).
- Do not leak full solution ground truth.

Return JSON:
{
  "narration": "..."
}`,
  accusation_start: `You are the narrator starting the accusation phase of a children's mystery game.

Task:
- Frame a dramatic accusation scene and ask for the player's accusation.
- If the accusation is forced by time pressure, make that urgency explicit.
- Ask the player to clearly name who they accuse and explain evidence.
- Keep language and readability appropriate for target age {{target_age}}.
- Keep text concise and clear.
- Context to incorporate when relevant: {{forced_context}}
- Use the provided character sex to choose pronouns. Never guess pronouns.

Return JSON:
{
  "narration": "...",
  "follow_up_prompt": "..."
}`,
  accusation_judge: `You are the adjudication narrator for the final accusation in a children's mystery game.

Task:
- Evaluate the player's reasoning against the mystery's hidden truth.
- Use the provided solution_paths to check if the player's deduction follows a valid reasoning chain.
- Use suspect_elimination_paths to verify the player correctly ruled out innocent suspects.
- Consider red_herrings to assess whether the player was misled by false leads.
- Keep language and readability appropriate for target age {{target_age}}.
- If the reasoning is incomplete, return "continue" with one targeted follow-up question.
- If reasoning is sufficient, decide "win" or "lose".
- Use the provided character sex to choose pronouns. Never guess pronouns.

Return JSON:
{
  "narration": "...",
  "accusation_resolution": "continue | win | lose",
  "follow_up_prompt": "string or null"
}`,
};

export async function loadPromptTemplate(role: AIRoleName): Promise<string> {
  return PROMPT_TEMPLATE_BY_ROLE[role];
}

export function renderPrompt(
  template: string,
  variables: Record<string, string | number | boolean | null | undefined>,
): string {
  return template.replaceAll(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_match, key: string) => {
      const value = variables[key];
      if (value === undefined || value === null) {
        return "";
      }

      return String(value);
    },
  );
}

export function buildGameStartPrompt(input: {
  target_age: number;
  premise: string;
}): string {
  return [
    "You are the narrator for a children's mystery game.",
    `Write an opening narration suitable for target age ${input.target_age}.`,
    "Keep the language clear, vivid, and easy to read for that child age.",
    "Open the case with the given premise and invite investigation.",
    "Keep the response concise.",
    `Premise: ${input.premise}`,
  ].join("\n");
}

export function buildGameMovePrompt(input: {
  target_age: number;
  destination_name: string;
  destination_description: string;
  has_visited_before: boolean;
  destination_history_json: string;
  destination_characters_json: string;
}): string {
  const revisitInstruction = input.has_visited_before
    ? "The player has been here before. Explicitly acknowledge the return visit, keep details consistent with earlier descriptions, and do not contradict prior narration."
    : "The player is arriving here for the first time in this session.";

  return [
    "You are the narrator for a children's mystery game.",
    `Describe the player arriving at ${input.destination_name}.`,
    `Keep the language and readability appropriate for target age ${input.target_age}.`,
    revisitInstruction,
    "Base the description on the provided destination description, destination-specific history, and the public summaries of characters currently present.",
    "If characters are present, mention who is visibly here using only the provided names and descriptions.",
    "Use each character's sex field to choose pronouns. Never guess pronouns.",
    "Do not invent extra characters or character details.",
    "Keep the narration concise and coherent.",
    `Destination description: ${input.destination_description}`,
    `Characters at destination: ${input.destination_characters_json}`,
    `Destination history: ${input.destination_history_json}`,
  ].join("\n");
}
