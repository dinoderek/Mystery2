import type { AIPromptKey } from "./ai-contracts.ts";
import {
  type InteractionId,
  renderComplexityGuidance,
  renderGuidance,
  renderLengthGuidance,
  renderOutcomeLengthGuidance,
} from "../../shared/src/age-profile.ts";
import { GRAPH_SEARCH_PROMPT, GRAPH_TALK_PROMPT } from "./clue-graph/prompts.ts";
import { GRAPH_ACCUSATION_PROMPT, GRAPH_ACCUSATION_ROUND_PROMPT, GRAPH_ENDING_PROMPT } from "./clue-graph/judge-guidance.ts";

// Each runtime role maps to one interaction, which sets its length guidance.
// A search whose outcome the engine does not know needs OUTCOME_LENGTH_BY_ROLE
// instead — see there.
const INTERACTION_BY_ROLE: Record<AIPromptKey, InteractionId> = {
  talk_end: "talk_farewell",
  accusation_start: "accusation_open",
  // A greeting asks for `talk_greeting`, and a search whose outcome
  // is known picks its budget (role-request.ts).
  graph_talk: "talk_round",
  graph_search: "search_find",
  // Writes no narration, so its prompt has no length.
  graph_accusation: "accusation_verdict",
  graph_accusation_round: "accusation_verdict",
  graph_ending: "accusation_verdict",
};

// Roles whose word budget depends on an outcome the model itself decides, so
// the backend cannot pick one up front the way it does for a search whose
// outcome it knows. The prompt states both budgets and the condition that
// selects them; without this a search that finds nothing is billed the roomier
// `search_find` budget.
const OUTCOME_LENGTH_BY_ROLE: Partial<
  Record<AIPromptKey, readonly { id: InteractionId; when: string }[]>
> = {
  graph_search: [
    { id: "search_find", when: "if you reveal a clue" },
    { id: "search_empty", when: "if you reveal nothing" },
  ],
};

/**
 * Age-band guidance (complexity + length) for a role, honouring an explicit
 * interaction override before falling back to the role's own budget — branched
 * when the role's budget depends on the outcome.
 */
function renderRoleGuidance(
  role: AIPromptKey,
  targetAge: number,
  interaction?: InteractionId,
): string {
  const branches = OUTCOME_LENGTH_BY_ROLE[role];
  if (!interaction && branches) {
    return `${renderComplexityGuidance(targetAge)}\n${
      renderOutcomeLengthGuidance(targetAge, branches)
    }`;
  }
  return renderGuidance(interaction ?? INTERACTION_BY_ROLE[role], targetAge);
}

/**
 * Age-band guidance (complexity + length) for a runtime role, ready to drop
 * into a prompt via the `{{age_guidance}}` placeholder. Single source of truth
 * is `age-profile.ts`.
 */
export function buildAgeGuidance(role: AIPromptKey, targetAge: number): string {
  return renderRoleGuidance(role, targetAge);
}

// Narrating roles share the same voice and limits on what they can make up.
const DIALOGUE = "- Characters always speak in direct first-person dialogue with brief action beats.";
// A failed accusation and the ending have no one speaking but the
// narrator. Told the dialogue rule there, the model quotes its own words and
// gives them to the investigator ("you say warmly"), so it is replaced. The
// ending retells the account, where a character's words may matter as said.
const NARRATOR_VOICE =
  "- No one speaks in this scene but you, the narrator: put none of your own words in quotation marks, and never give a line to the investigator, to yourself or to a voice.";
const NARRATOR_VOICE_BY_ROLE: Partial<Record<AIPromptKey, string>> = {
  graph_accusation_round: NARRATOR_VOICE,
  graph_ending: `${NARRATOR_VOICE} What a character said in the account may be quoted as they said it.`,
};
const NARRATION_STYLE = [
  "## Narration style",
  '- Address the player as "you", the investigator, in the present tense.',
  "- Tone: warm, playful, and curious — a cozy mystery for children, never scary or gory.",
  "- Prefer concrete, sensory detail over summary; one vivid touch beats three vague ones.",
  DIALOGUE,
  "- Never mention game mechanics, prompts, JSON, or that you are an AI.",
  "- Use only the characters, places and facts you are given. Each is a fact to put in your own words, keeping every name, time, place and object. Choose pronouns from each character's sex, never by guessing.",
].join("\n");
const INVENTION = [
  "",
  "## What you may make up",
  "You may add scenery and manner (weather, a smell, a sound, how someone fidgets) to bring the scene to life, under two rules:",
  "- Nothing you add looks like evidence or bears on who, when or where: no marks, objects to examine, times, sightings, people or places to search beyond what you are given.",
  "- What earlier narration established stays: keep the place, the weather and how people look as they were already described, on this turn and every later visit.",
].join("\n");

/**
 * Style guidance for a runtime prompt: the standard narrator style, with the
 * role's own voice in place of the dialogue line when it has one.
 */
export function buildStyleGuidance(narratorVoice?: string): string {
  const voiced = narratorVoice ? NARRATION_STYLE.replace(DIALOGUE, narratorVoice) : NARRATION_STYLE;
  return `${voiced}\n${INVENTION}`;
}

// Prompts are embedded intentionally so runtime does not depend on filesystem
// behavior inside the edge bundler. The `{{age_guidance}}` placeholder is filled
// per role + target age from `age-profile.ts` (see buildAgeGuidance), and
// `{{style_guidance}}` with the shared layer above.
const PROMPT_TEMPLATE_BY_ROLE: Record<AIPromptKey, string> = {
  talk_end: `You are the narrator for a children's mystery game.
{{age_guidance}}
{{style_guidance}}

Task:
- Close the active conversation with {{character_name}} in {{location_name}}.
- End with {{character_name}}'s farewell and one short beat of the investigator
  still in {{location_name}}, ready to look around.
- The investigator stays exactly where they are. Ending a talk moves nobody:
  no stepping in, out, back, away or outside, and no weather or ground
  underfoot that the location's description does not give.
- The farewell gives nothing new away: no clue, confession or hidden fact.

Return JSON:
{
  "narration": "..."
}`,
  accusation_start: `You are the narrator starting the accusation phase of a children's mystery game.
{{age_guidance}}
{{style_guidance}}

Task:
- Frame a dramatic accusation scene and ask for the player's accusation.
- If the accusation is forced by time pressure, make that urgency explicit.
- Context to incorporate when relevant: {{forced_context}}
- The people listed in accusation_start_context.characters are the only
  characters in this mystery. Use only those names.
- End the narration with one short, direct question asking who they accuse and
  what evidence they have.

Return JSON:
{
  "narration": "..."
}`,
  graph_talk: GRAPH_TALK_PROMPT,
  graph_search: GRAPH_SEARCH_PROMPT,
  graph_accusation: GRAPH_ACCUSATION_PROMPT,
  graph_accusation_round: GRAPH_ACCUSATION_ROUND_PROMPT,
  graph_ending: GRAPH_ENDING_PROMPT,
};

export interface LoadPromptOptions {
  /**
   * Override the interaction whose word budget applies: a greeting, and a
   * search whose outcome the engine already knows.
   */
  interaction?: InteractionId;
}

/**
 * Load a role template with its age-band and style guidance already injected.
 *
 * `targetAge` is REQUIRED: the guidance is filled here, not by the caller, so a
 * handler cannot accidentally ship a prompt with blank `{{age_guidance}}` — a
 * missing age is a compile error, not a silent empty substitution. The
 * `{{style_guidance}}` slot is likewise always filled.
 */
export async function loadPromptTemplate(
  role: AIPromptKey,
  targetAge: number,
  options: LoadPromptOptions = {},
): Promise<string> {
  return PROMPT_TEMPLATE_BY_ROLE[role]
    .replace(
      "{{age_guidance}}",
      renderRoleGuidance(role, targetAge, options.interaction),
    )
    .replace(
      "{{style_guidance}}",
      buildStyleGuidance(NARRATOR_VOICE_BY_ROLE[role]),
    );
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

const OPENING_FACTS_HEADER = "Opening facts:";
const PLACE_FACTS_HEADER = "Facts about the place:";

function factLines(header: string, facts: string[]): string[] {
  return [header, ...facts.map((fact) => `- ${fact}`)];
}

/** Read the list of case facts back out for the mock narrator. */
function readFactLines(prompt: string, header: string): string[] | null {
  const lines = prompt.split("\n");
  const start = lines.indexOf(header);
  if (start < 0) return null;
  const facts: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("- ")) break;
    facts.push(line.slice(2));
  }
  return facts;
}

/** The opening: the case's public facts, every one of which it words. */
export function buildGameStartPrompt(input: { target_age: number; facts: string[] }): string {
  return [
    "You are the narrator for a children's mystery game.",
    renderComplexityGuidance(input.target_age),
    renderLengthGuidance("intro", input.target_age),
    buildStyleGuidance(),
    "Open the case and invite investigation. Tell every fact below in your own words; leave none out.",
    ...factLines(OPENING_FACTS_HEADER, input.facts),
  ].join("\n");
}

/** An opening's facts, read back out of its prompt, or null for any other prompt: how the mock recognises one. */
export function readOpeningFacts(prompt: string): string[] | null {
  return readFactLines(prompt, OPENING_FACTS_HEADER);
}

// Arrival is not a conversation: nobody has asked anything, so a character
// arrives with their personality, a demeanor line and how they look; nothing
// they know or hold.
const ARRIVAL_CHARACTER_RULES = [
  "## Characters present",
  "- Show each character from their appearance, personality and initial_attitude_towards_investigator.",
  "- A character may react or say one short line in the first person. They do not start a conversation or share information; the investigator has not asked them anything yet.",
].join("\n");

const ARRIVAL_HEADLINE = /^Describe the player arriving at (.+)\.$/m;
const ARRIVAL_CHARACTERS_PREFIX = "Characters at destination: ";

export function buildGameMovePrompt(input: {
  target_age: number;
  destination_name: string;
  has_visited_before: boolean;
  last_arrival_narration?: string | null;
  destination_characters_json: string;
  destination_sub_locations_json?: string;
  /** The place's facts, which the arrival words. */
  destination_facts: string[];
}): string {
  const revisitInstruction = input.has_visited_before
    ? "The player has been here before. Explicitly acknowledge the return visit and keep the place, not the people's moods, as the last arrival described it."
    : "The player is arriving here for the first time in this session.";
  const hasCharacters = input.destination_characters_json.trim() !== "[]";

  return [
    "You are the narrator for a children's mystery game.",
    `Describe the player arriving at ${input.destination_name}.`,
    renderComplexityGuidance(input.target_age),
    renderLengthGuidance("ambience", input.target_age),
    buildStyleGuidance(),
    revisitInstruction,
    "Describe the place from its facts, every one, and who is visibly here from their names and appearances.",
    ...(hasCharacters ? [ARRIVAL_CHARACTER_RULES] : []),
    ...(input.destination_sub_locations_json
      ? [
          "When describing the location, prominently mention the searchable areas so the player knows what they can investigate. Weave them naturally into the description.",
          `Searchable areas at this location: ${input.destination_sub_locations_json}`,
        ]
      : []),
    ...factLines(PLACE_FACTS_HEADER, input.destination_facts),
    `${ARRIVAL_CHARACTERS_PREFIX}${input.destination_characters_json}`,
    ...(input.has_visited_before && input.last_arrival_narration
      ? [`Last arrival here: ${JSON.stringify(input.last_arrival_narration)}`]
      : []),
  ].join("\n");
}

/**
 * Read the place and the present characters' names back out of an arrival
 * prompt, or null for any other prompt. Narration has no context object, so
 * this is how the mock provider recognises an arrival; it lives beside
 * `buildGameMovePrompt` so the two cannot drift.
 */
export function readArrivalPrompt(
  prompt: string,
): { destination_name: string; character_names: string[]; facts: string[] | null } | null {
  const headline = ARRIVAL_HEADLINE.exec(prompt);
  if (!headline) return null;
  const charactersLine = prompt.split("\n").find((line) => line.startsWith(ARRIVAL_CHARACTERS_PREFIX));
  let characters: Array<{ first_name?: unknown }>;
  try {
    characters = JSON.parse(charactersLine?.slice(ARRIVAL_CHARACTERS_PREFIX.length) ?? "[]");
  } catch {
    characters = [];
  }
  return {
    destination_name: headline[1],
    character_names: characters
      .map((c) => c.first_name)
      .filter((name): name is string => typeof name === "string"),
    facts: readFactLines(prompt, PLACE_FACTS_HEADER),
  };
}
