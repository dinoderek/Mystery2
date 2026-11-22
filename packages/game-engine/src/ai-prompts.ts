import type { AIPromptKey } from "./ai-contracts.ts";
import {
  type InteractionId,
  renderComplexityGuidance,
  renderGuidance,
  renderLengthGuidance,
  renderOutcomeLengthGuidance,
} from "../../shared/src/age-profile.ts";
import { buildTalkConversationTemplate, FULL_TALK_PROFILE, type TalkPromptProfile } from "./talk-prompt.ts";
import { GRAPH_SEARCH_PROMPT, GRAPH_TALK_PROMPT } from "./clue-graph/prompts.ts";
import { GRAPH_ACCUSATION_PROMPT, GRAPH_ACCUSATION_ROUND_PROMPT, GRAPH_ENDING_PROMPT } from "./clue-graph/judge-guidance.ts";

// Each runtime role maps to one interaction, which sets its length guidance.
// `search_bare` defaults to the lean "nothing found" budget; the search handler
// overrides it to `search_find` on turns where a clue will be revealed (see
// LoadPromptOptions.interaction). `search_targeted` is the exception that needs
// OUTCOME_LENGTH_BY_ROLE instead — see there.
const INTERACTION_BY_ROLE: Record<AIPromptKey, InteractionId> = {
  talk_start: "talk_greeting",
  talk_conversation: "talk_round",
  talk_end: "talk_farewell",
  search_bare: "search_empty",
  search_targeted: "search_find",
  accusation_start: "accusation_open",
  accusation_judge: "accusation_verdict",
  // A clue-graph greeting asks for `talk_greeting`, and a search whose outcome
  // is known picks its budget (role-request.ts).
  graph_talk: "talk_round",
  graph_search: "search_find",
  // The accusation's judge writes no narration, so its prompt has no length.
  graph_accusation: "accusation_verdict",
  graph_accusation_round: "accusation_verdict",
  graph_ending: "accusation_verdict",
};

// Roles whose word budget depends on an outcome the model itself decides, so
// the backend cannot pick one up front the way it does for bare search. The
// prompt states both budgets and the condition that selects them; without this
// a targeted search that finds nothing was billed the roomier `search_find`
// budget — around 2.5x the words of an equally empty bare search.
const OUTCOME_LENGTH_BY_ROLE: Partial<
  Record<AIPromptKey, readonly { id: InteractionId; when: string }[]>
> = {
  search_targeted: [
    { id: "search_find", when: "if you reveal a clue" },
    { id: "search_empty", when: "if you reveal nothing" },
  ],
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

// The shared layer every runtime prompt carries: the standard narrator voice and
// the grounding rules, stated here once rather than in each role's prompt. A
// blueprint may extend the voice via metadata.narration_style (see
// buildStyleGuidance); the reading level above it always wins.
const PRONOUNS = "Choose pronouns from each character's sex, never by guessing.";
const NEVER_INVENT = `- Use only the characters, places and facts you are given; never invent more. ${PRONOUNS}`;
const STANDARD_NARRATION_STYLE = [
  "## Narration style",
  '- Address the player as "you", the investigator, in the present tense.',
  "- Tone: warm, playful, and curious — a cozy mystery for children, never scary or gory.",
  "- Prefer concrete, sensory detail over summary; one vivid touch beats three vague ones.",
  "- Characters always speak in direct first-person dialogue with brief action beats.",
  "- Never mention game mechanics, prompts, JSON, or that you are an AI.",
  NEVER_INVENT,
].join("\n");

// A clue-graph case hands the narrator facts to word, and lets it add mood
// under two rules (`docs/clue-graph.md`, "The narrator's judgement"): this
// replaces the standard style's last line, NEVER_INVENT, and follows the style.
const CLUE_GRAPH_FACTS = `- Use only the characters, places and facts you are given. Each is a fact to put in your own words, keeping every name, time, place and object. ${PRONOUNS}`;
const CLUE_GRAPH_INVENTION = [
  "",
  "## What you may make up",
  "You may add scenery and manner (weather, a smell, a sound, how someone fidgets) to bring the scene to life, under two rules:",
  "- Nothing you add looks like evidence or bears on who, when or where: no marks, objects to examine, times, sightings, people or places to search beyond what you are given.",
  "- What earlier narration established stays: keep the place, the weather and how people look as they were already described, on this turn and every later visit.",
].join("\n");

/**
 * Style guidance for a runtime prompt: the standard narrator style, plus the
 * blueprint's own optional voice (`metadata.narration_style`) layered on top.
 * A clue-graph case's narration may invent mood, never evidence.
 */
export function buildStyleGuidance(narrationStyle?: string | null, options: { clueGraph?: boolean } = {}): string {
  const standard = options.clueGraph
    ? STANDARD_NARRATION_STYLE.replace(NEVER_INVENT, CLUE_GRAPH_FACTS)
    : STANDARD_NARRATION_STYLE;
  const custom = narrationStyle?.trim();
  const style = !custom
    ? standard
    : [
        standard,
        `- This mystery's own voice (follow it within the rules above): ${custom}`,
        "- That voice flavors tone and imagery only, never harder words or longer sentences: where it and the reading level pull apart, the reading level wins.",
      ].join("\n");
  return options.clueGraph ? `${style}\n${CLUE_GRAPH_INVENTION}` : style;
}

// Prompts are embedded intentionally so runtime does not depend on filesystem
// behavior inside the edge bundler. The `{{age_guidance}}` placeholder is filled
// per role + target age from `age-profile.ts` (see buildAgeGuidance), and
// `{{style_guidance}}` with the shared layer above. `talk_conversation` is
// assembled per character instead (`talk-prompt.ts`).
const PROMPT_TEMPLATE_BY_ROLE: Record<Exclude<AIPromptKey, "talk_conversation">, string> = {
  talk_start: `You are the in-character narrator for a children's mystery game.
{{age_guidance}}
{{style_guidance}}

Task:
- Start a conversation with {{character_name}} in {{location_name}}. Briefly
  describe them where they are, then have them greet or acknowledge the
  investigator in their own voice.
- The investigator and {{character_name}} are both already in
  {{location_name}}. Talking moves nobody: do not narrate the investigator
  walking up, arriving, stepping in or out, or their footsteps.
- Their opening attitude follows their initial_attitude_towards_investigator
  and agendas: someone protecting themselves might be wary or too casual, one
  blaming someone eager to talk, one protecting someone distracted.

## Nothing is given away in a greeting
The investigator has turned to them but has not said anything yet, so nothing
has been earned this turn.
- Do not reveal or hint at any of the character's clues or hidden facts, and
  do not confess, crack, or drop the stated alibi.
- Tells: the character context's "tells" array decides what may show.
  - trigger.kind = "always": may surface naturally.
  - trigger.kind = "condition": only if the conversation history already shows
    the condition met in an earlier visit.
  - trigger.kind = "clue": NEVER in a greeting. It needs the investigator to
    raise that clue, and they have not said anything yet.
  A guarded or nervous character shows it through their authored attitude, not
  through a tell that has not been triggered. An untriggered tell's cue is off
  limits even in a milder form: if a clue tell says "her tail puffs up", no tail
  puffing at all.

Return JSON:
{
  "narration": "..."
}`,
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
  search_bare: `You are the Game Master narrator for a children's mystery game.
{{age_guidance}}
{{style_guidance}}

Task:
- The player is doing a general search of {{location_name}} (no specific target).
- If search_context.next_clue is present, reveal it: set revealed_clue_id to that clue's id and weave the clue text into your narration.
- If search_context.next_clue is null, reveal nothing new: set revealed_clue_id to null and give only flavorful feedback.
- Never reveal again a clue in search_context.revealed_clue_ids.
- If sub-locations with unrevealed clues exist, mention interesting areas that could be searched more specifically.

Return JSON:
{
  "narration": "...",
  "revealed_clue_id": "clue-id-here or null",
  "costs_turn": true,
  "input_understood": true
}`,
  search_targeted: `You are the Game Master narrator for a children's mystery game. You act like a tabletop RPG Game Master, adjudicating the player's search attempt.
{{age_guidance}}
{{style_guidance}}

Task:
- The player is searching {{location_name}} with this description: "{{search_query}}"
- Judge whether the description matches a sub-location with unrevealed clues. You have GM leeway: an inventive, cunning description can match even when its wording does not. A description that names no place or thing, such as "around" or "for clues", matches none.
- On a match, set revealed_clue_id to that clue's id and weave the clue text verbatim into your narration.
- With no match, set revealed_clue_id to null. Narrate what the player finds (nothing clue-worthy) and hint at sub-locations that still have undiscovered clues.
- Never reveal again a clue in search_context.revealed_clue_ids.
- costs_turn: true for a meaningful attempt, even an unsuccessful one. false when the search is completely off the mark: do not punish the player for exploring.
- Unintelligible input: if the description is gibberish, do not invent a result.
  Give a brief in-character "huh?" beat (e.g. "You poke around, but you're not
  sure what you're even looking for.") and set input_understood to false.
  Otherwise set input_understood to true.

Return JSON:
{
  "narration": "...",
  "revealed_clue_id": "clue-id-here or null",
  "costs_turn": true or false,
  "input_understood": true
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
  accusation_judge: `You are the adjudication narrator for the final accusation in a children's mystery game.
{{age_guidance}}
{{style_guidance}}

Task:
- Judge the player's accusation and reasoning against the mystery's hidden
  truth: ground_truth, solution_paths, suspect_elimination_paths, and
  red_herrings in the provided full blueprint.

## What the investigator actually found
The full blueprint lists every clue that EXISTS in this mystery — most of which
the player may never have found. Do not assume they know any of it.

- \`player_known_clues\` is the set they actually discovered this session, each
  with where it came from. This is the only record of what they earned.
- \`path_coverage\` splits each reasoning path's clues into \`found_clue_ids\`
  and \`missing_clue_ids\` for you, so you do not have to work it out yourself.

Read \`path_coverage\` to gauge how strong their case is:
- Most of a solution path found → they have essentially cracked it. Accept, or
  ask ONE targeted question about a fact in \`missing_clue_ids\`.
- Their case leans on a red_herring path → they were misled. Nudge them ("are
  you certain about the boots?"), never punish.
- Little found on any path → they are guessing rather than reasoning.

Three rules about this data:
- \`missing_clue_ids\` exists to help you ASK A BETTER QUESTION. It is never a
  checklist to reject against. A player does not need every clue on a path.
- These are the clues they can CITE as evidence — not a fence around what they
  are allowed to think. A child who reasons their way to a fact nobody handed
  them is doing exactly what this game is for. Credit that.
- This section constrains route 1 below ONLY. Route 2 and a confession earned
  by confrontation do not require discovered clues.

## When to accept (resolution "win")
Accept ONLY when the player names the true culprit AND at least one of these
holds:
1. Evidence chain: their reasoning follows one of the solution_paths — they
   cite, in their own words, the substance of clues they actually hold (see
   \`player_known_clues\`).
2. True account: they correctly tell the story of what happened — the culprit,
   the key sequence of events, and the motive — matching ground_truth, even if
   they cite clues loosely.
Judge substance, not wording. Most of the key facts must be right; naming the
culprit with no supporting facts is a lucky guess, not a win.

## Confrontation and confession
If the player confronts the accused directly (or asks to), you may play the
confrontation out in the narration. The culprit confesses ONLY when the player
already has most of the facts right — the culprit plus the substance of what
happened or of the evidence against them. A confession earned this way is a
"win". Confronted with weak or wrong facts, the culprit deflects.

## When to reject (resolution "continue" or "lose")
- Wrong suspect, or right suspect with too few facts: return "continue".
  Reject warmly in the narration — say the case is not proven yet, hint at what
  KIND of fact is missing (never reveal the answer), and end with
  one short, direct question that invites the player to try again. The player
  is still in the accusation: ask about what they know or can reason out, never
  send them somewhere to look.
- The provided round counts the player's completed reasoning attempts. From
  round 3 onward, if the accusation still fails, return "lose" with a gentle,
  hopeful closing that kindly reveals the truth.
- On "win" or "lose" the case is over: do not end with a question.
- Use suspect_elimination_paths to check whether the player ruled out innocent
  suspects, and red_herrings to recognize when they were misled.

Return JSON:
{
  "narration": "...",
  "accusation_resolution": "continue | win | lose"
}`,
  graph_talk: GRAPH_TALK_PROMPT,
  graph_search: GRAPH_SEARCH_PROMPT,
  graph_accusation: GRAPH_ACCUSATION_PROMPT,
  graph_accusation_round: GRAPH_ACCUSATION_ROUND_PROMPT,
  graph_ending: GRAPH_ENDING_PROMPT,
};

export interface LoadPromptOptions {
  /**
   * Override the interaction whose word budget applies. Used by bare search,
   * which defaults to the lean `search_empty` budget but needs the roomier
   * `search_find` budget on turns where the backend already knows a clue will
   * be revealed.
   */
  interaction?: InteractionId;
  /**
   * The blueprint's optional narration voice (`metadata.narration_style`),
   * layered on top of the standard narrator style.
   */
  narrationStyle?: string | null;
  /**
   * What the active character has, which picks the `talk_conversation`
   * sections (`talk-prompt.ts`). Without one, every section is included.
   */
  talkProfile?: TalkPromptProfile;
  /** A clue-graph case: the narrator words facts and may invent mood, never evidence. */
  clueGraph?: boolean;
}

/**
 * Load a role template with its age-band and style guidance already injected.
 *
 * `targetAge` is REQUIRED: the guidance is filled here, not by the caller, so a
 * handler cannot accidentally ship a prompt with blank `{{age_guidance}}` — a
 * missing age is a compile error, not a silent empty substitution. The
 * `{{style_guidance}}` slot is likewise always filled: with the standard
 * narrator style alone, or with the blueprint's voice layered on top.
 */
export async function loadPromptTemplate(
  role: AIPromptKey,
  targetAge: number,
  options: LoadPromptOptions = {},
): Promise<string> {
  const template = role === "talk_conversation"
    ? buildTalkConversationTemplate(options.talkProfile ?? FULL_TALK_PROFILE)
    : PROMPT_TEMPLATE_BY_ROLE[role];
  return template
    .replace(
      "{{age_guidance}}",
      renderRoleGuidance(role, targetAge, options.interaction),
    )
    .replace("{{style_guidance}}", buildStyleGuidance(options.narrationStyle, { clueGraph: options.clueGraph }));
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

/** Facts as a prompt lists them, one to a line, under a header a reader can find. */
function factLines(header: string, facts: string[]): string[] {
  return [header, ...facts.map((fact) => `- ${fact}`)];
}

/** The facts listed under `header`, read back out of a prompt; null when it has none. */
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

/**
 * The opening. A V2 case gives a premise; a clue-graph case gives its public
 * facts, every one of which the opening words.
 */
export function buildGameStartPrompt(input: {
  target_age: number;
  premise: string;
  narration_style?: string | null;
  facts?: string[];
}): string {
  const clueGraph = input.facts !== undefined;
  return [
    "You are the narrator for a children's mystery game.",
    renderComplexityGuidance(input.target_age),
    renderLengthGuidance("intro", input.target_age),
    buildStyleGuidance(input.narration_style, { clueGraph }),
    ...(input.facts
      ? [
          "Open the case and invite investigation. Tell every fact below in your own words; leave none out.",
          ...factLines(OPENING_FACTS_HEADER, input.facts),
        ]
      : ["Open the case with the given premise and invite investigation.", `Premise: ${input.premise}`]),
  ].join("\n");
}

/** A clue-graph opening's facts, read back out of its prompt, or null for any other prompt: how the mock recognises one. */
export function readOpeningFacts(prompt: string): string[] | null {
  return readFactLines(prompt, OPENING_FACTS_HEADER);
}

// Arrival is not a conversation: nobody has asked anything, so each present
// character comes only with how they look and carry themselves.
const ARRIVAL_CHARACTER_RULES = [
  "## Characters present",
  "- Play each character in their initial_attitude_towards_investigator and personality. A guarded character stays guarded; a nervous one shows it.",
  "- manner is how their aims show before anyone speaks, first matters most: hovering, changing the subject, a glance elsewhere. Show it; never explain it.",
  "- A character who wants attention elsewhere points it at a person their manner names, or at nothing in particular, never at a thing or spot here: you don't know what is hidden where.",
  "- A tell in tells may surface as written.",
  "- A character may react or say one short line in the first person. They do not start a conversation or share information; the investigator has not asked them anything yet.",
].join("\n");

// A clue-graph character arrives with their personality, a demeanor line and
// how they look; nothing they know or hold.
const GRAPH_ARRIVAL_CHARACTER_RULES = [
  "## Characters present",
  "- Show each character from their appearance, personality and initial_attitude_towards_investigator.",
  "- A character may react or say one short line in the first person. They do not start a conversation or share information; the investigator has not asked them anything yet.",
].join("\n");

const ARRIVAL_HEADLINE = /^Describe the player arriving at (.+)\.$/m;
const ARRIVAL_CHARACTERS_PREFIX = "Characters at destination: ";

export function buildGameMovePrompt(input: {
  target_age: number;
  destination_name: string;
  destination_description: string;
  has_visited_before: boolean;
  last_arrival_narration?: string | null;
  destination_characters_json: string;
  destination_sub_locations_json?: string;
  narration_style?: string | null;
  /** A clue-graph case: the place's facts, which the arrival words in place of a description. */
  destination_facts?: string[];
}): string {
  const clueGraph = input.destination_facts !== undefined;
  const revisitInstruction = input.has_visited_before
    ? "The player has been here before. Explicitly acknowledge the return visit and keep the place, not the people's moods, as the last arrival described it."
    : "The player is arriving here for the first time in this session.";
  const hasCharacters = input.destination_characters_json.trim() !== "[]";

  return [
    "You are the narrator for a children's mystery game.",
    `Describe the player arriving at ${input.destination_name}.`,
    renderComplexityGuidance(input.target_age),
    renderLengthGuidance("ambience", input.target_age),
    buildStyleGuidance(input.narration_style, { clueGraph }),
    revisitInstruction,
    clueGraph
      ? "Describe the place from its facts, every one, and who is visibly here from their names and appearances."
      : "Describe the place from the destination description, and who is visibly here from their names and appearances.",
    ...(hasCharacters ? [clueGraph ? GRAPH_ARRIVAL_CHARACTER_RULES : ARRIVAL_CHARACTER_RULES] : []),
    ...(input.destination_sub_locations_json
      ? [
          "When describing the location, prominently mention the searchable areas so the player knows what they can investigate. Weave them naturally into the description.",
          `Searchable areas at this location: ${input.destination_sub_locations_json}`,
        ]
      : []),
    ...(input.destination_facts
      ? factLines(PLACE_FACTS_HEADER, input.destination_facts)
      : [`Destination description: ${input.destination_description}`]),
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
  const charactersLine = prompt
    .split("\n")
    .find((line) => line.startsWith(ARRIVAL_CHARACTERS_PREFIX));
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
