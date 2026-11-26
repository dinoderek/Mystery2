/**
 * Prompt assembly — the single place a narrator request is built.
 *
 * Every request carries the reader's age as its own `reading_age`, read from
 * the profile on that request; the case has no say in it.
 *
 * WHY THIS EXISTS
 *
 * Assembling a narrator request means three things: pick the role, build its
 * context, and render its prompt at the request's `reading_age`. That used to be inlined in every endpoint handler AND
 * re-implemented by the runtime eval harness, so there were two independent
 * assembly paths. They drifted: the harness called
 * `loadPromptTemplate(role)` with no age and no style, so `clampTargetAge`
 * silently fell back to age 6 and every evaluated prompt was built for the
 * wrong reader while being graded against another age.
 *
 * One assembly path removes that class of bug by construction. Transport —
 * an HTTP call to the server, or a local CLI replay — becomes a detail
 * layered on top rather than a second implementation.
 *
 * PURITY CONTRACT
 *
 * This module must import only its siblings in this package and must not touch
 * the network or the database. The eval harness imports it directly so that it
 * and the server assemble prompts the same way. Callers derive their own
 * inputs — anything needing a DB read (event history, discovered clues, the
 * next clue to reveal) is passed in, not fetched here.
 */

import type { AIPromptKey, AIRoleName } from "./ai-contracts.ts";
import { authoredFieldBudget, type InteractionId } from "../../shared/src/age-profile.ts";
import {
  type AIContext,
  type BlueprintContext,
  buildAccusationStartContext,
  buildArrivalCharacterContexts,
  buildGraphAccusationAIContext,
  buildGraphSearchAIContext,
  buildGraphTalkAIContext,
  buildGraphVerdictAIContext,
  buildTalkEndContext,
  type ConversationFragment,
  findCharacterById,
  findLocationById,
  selectLastArrivalNarration,
  selectLocationConversationHistory,
  type SessionSnapshot,
} from "./ai-context.ts";
import {
  buildGameMovePrompt,
  buildGameStartPrompt,
  loadPromptTemplate,
  renderPrompt,
} from "./ai-prompts.ts";
import { clueGraphRoleGuidance } from "./clue-graph/judge-guidance.ts";
import { GRAPH_TALK_EARLIER_LINES, GRAPH_TALK_GREETING_TURN, GRAPH_TALK_LINE_TURN } from "./clue-graph/prompts.ts";
import { linesThisConversation, playOf } from "./clue-graph/history.ts";
import { visibleSpots } from "./clue-graph/play.ts";
import type { AccusationVerdict } from "./clue-graph/accusation.ts";

/**
 * The two narrator outputs that are plain narration rather than a role-output
 * contract: they call `generateNarration` with a code-built prompt and have no
 * context object. Named for their age-profile interaction so every narrator
 * output in the system has one name here.
 */
export type NarrationRoleName = "intro" | "ambience";

export type RoleRequestName = AIPromptKey | NarrationRoleName;

/** Transport-independent messages. The system message sets the output format. */
export interface NarratorMessages {
  system: string;
  user: string;
}

export function buildNarrationMessages(prompt: string): NarratorMessages {
  return {
    system: "You are the narrator for a kids mystery game. Return plain text only.",
    user: prompt,
  };
}

export function buildRoleMessages(request: { role: AIRoleName; prompt: string; context: Record<string, unknown> }): NarratorMessages {
  return {
    system: `You are a strict JSON API for role "${request.role}". Output JSON only.`,
    user: JSON.stringify({ prompt: request.prompt, context: request.context }),
  };
}

/**
 * A role-output request: prompt plus the context the provider validates and
 * the narrator reads. `context` is never null here — narration roles have no
 * context and use `buildNarrationPrompt` instead, so callers never have to
 * null-check something that structurally cannot be absent.
 */
export interface RoleRequest {
  role: AIPromptKey;
  prompt: string;
  context: AIContext;
}

/** Fields every request carries. `game_id` is only an echo in the context. */
interface CommonInput {
  game_id: string;
  blueprint: BlueprintContext;
  /** The age the narration is written for: the reader's, on this request. */
  reading_age: number;
  conversation_history?: ConversationFragment[];
}

interface SessionInput extends CommonInput {
  session: SessionSnapshot;
}

export type RoleRequestInput =
  | ({ role: "intro" } & CommonInput)
  // Everything else an arrival needs — whether the place was visited before,
  // what happened there, who is present and what the player already holds — is
  // derived from `conversation_history` (the whole session's events; empty for
  // `game-enter`), so the endpoints and the eval harness cannot disagree on it.
  | ({ role: "ambience"; destination_id: string } & CommonInput)
  | ({ role: "talk_end"; character_id: string; location_id: string } & SessionInput)
  // Talk and search: the state comes from the history.
  | ({
    role: "graph_talk";
    character_id: string;
    location_id: string;
    /** Null for the greeting. */
    player_input: string | null;
  } & SessionInput)
  | ({ role: "graph_search"; location_id: string; search_query: string | null } & SessionInput)
  // An accusation: the judge, then what the engine decided, worded.
  | ({ role: "graph_accusation"; player_input: string } & SessionInput)
  | ({ role: "graph_accusation_round"; player_input: string; verdict: AccusationVerdict; accused: string | null; cited: string[] } & SessionInput)
  | ({ role: "graph_ending"; player_input: string; verdict: AccusationVerdict; cited: string[] } & SessionInput)
  | ({
    role: "accusation_start";
    forced_by_timeout?: boolean;
    forced_context?: string;
    history_mode?: "all" | "none";
  } & SessionInput);

type InputFor<R extends RoleRequestName> = Extract<RoleRequestInput, { role: R }>;

/** How long a notebook line runs at the reader's age: the age's length for a clue. */
function notebookWords(readingAge: number): number {
  return authoredFieldBudget("clue_text", readingAge);
}

function locationNameFor(blueprint: BlueprintContext, locationId: string | null | undefined): string {
  if (!locationId) return "";
  return findLocationById(blueprint, locationId)?.name ?? locationId;
}

function characterNameFor(blueprint: BlueprintContext, characterId: string): string {
  return findCharacterById(blueprint, characterId)?.first_name ?? characterId;
}

/**
 * Per-role assembly. `context` builds the role-output context (absent for
 * narration roles, which build their whole prompt in `prompt`); `vars` supplies
 * the template variables; `interaction` overrides the age-profile word budget
 * where the role's budget depends on state the caller knows.
 */
interface TemplateRoleSpec<R extends AIPromptKey> {
  kind: "template";
  context: (input: InputFor<R>) => AIContext;
  vars: (input: InputFor<R>) => Record<string, string | number | boolean | null | undefined>;
  interaction?: (input: InputFor<R>) => InteractionId | undefined;
}

interface NarrationRoleSpec<R extends NarrationRoleName> {
  kind: "narration";
  prompt: (input: InputFor<R>) => string;
}

type RoleSpec =
  | TemplateRoleSpec<AIPromptKey>
  | NarrationRoleSpec<NarrationRoleName>;

// The registry is heterogeneous by design; each entry is checked against its
// own input variant at the call sites below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REGISTRY: Record<RoleRequestName, any> = {
  intro: {
    kind: "narration",
    prompt: (input: InputFor<"intro">) =>
      // The opening words the case's public facts.
      buildGameStartPrompt({
        reading_age: input.reading_age,
        facts: input.blueprint.clue_graph.opening.facts,
      }),
  } satisfies NarrationRoleSpec<"intro">,

  ambience: {
    kind: "narration",
    prompt: (input: InputFor<"ambience">) => {
      const destination = findLocationById(input.blueprint, input.destination_id);
      if (!destination) {
        throw new Error(`Location ${input.destination_id} not found in blueprint`);
      }
      const history = input.conversation_history ?? [];
      const lastArrival = selectLastArrivalNarration(history, destination.id);
      // A hidden spot is not advertised until its pointer is held.
      const graph = input.blueprint.clue_graph;
      const shown = new Set(visibleSpots(graph, playOf(graph, history), destination.id));
      const subLocations = destination.sub_locations
        .filter((sl) => shown.has(sl.name))
        .map((sl) => ({ name: sl.name }));
      return buildGameMovePrompt({
        reading_age: input.reading_age,
        destination_name: destination.name,
        has_visited_before: selectLocationConversationHistory(history, destination.id).length > 0,
        last_arrival_narration: lastArrival,
        destination_characters_json: JSON.stringify(
          buildArrivalCharacterContexts(input.blueprint, destination.id),
        ),
        destination_sub_locations_json:
          subLocations.length > 0 ? JSON.stringify(subLocations) : undefined,
        destination_facts: graph.locations[destination.id].facts,
      });
    },
  } satisfies NarrationRoleSpec<"ambience">,

  talk_end: {
    kind: "template",
    context: (input: InputFor<"talk_end">) =>
      buildTalkEndContext({
        game_id: input.game_id,
        session: input.session,
        blueprint: input.blueprint,
        reading_age: input.reading_age,
        character_id: input.character_id,
        location_id: input.location_id,
        conversation_history: input.conversation_history,
      }),
    vars: (input: InputFor<"talk_end">) => ({
      character_name: characterNameFor(input.blueprint, input.character_id),
      location_name: locationNameFor(input.blueprint, input.location_id),
    }),
  } satisfies TemplateRoleSpec<"talk_end">,

  graph_talk: {
    kind: "template",
    context: (input: InputFor<"graph_talk">) =>
      buildGraphTalkAIContext({
        game_id: input.game_id,
        session: input.session,
        blueprint: input.blueprint,
        reading_age: input.reading_age,
        character_id: input.character_id,
        location_id: input.location_id,
        player_input: input.player_input,
        conversation_history: input.conversation_history,
      }),
    vars: (input: InputFor<"graph_talk">) => {
      const characterName = characterNameFor(input.blueprint, input.character_id);
      // The player's earlier lines in this conversation, beside this one, so a dodged clue's follow-up reads as one.
      const earlier = linesThisConversation(input.conversation_history ?? [], input.character_id);
      const names = {
        character_name: characterName,
        player_input: input.player_input ?? "",
        earlier_lines:
          earlier.length === 0
            ? ""
            : renderPrompt(GRAPH_TALK_EARLIER_LINES, { character_name: characterName, lines: earlier.map((line) => `- "${line}"`).join("\n") }),
      };
      return {
        ...names,
        location_name: locationNameFor(input.blueprint, input.location_id),
        turn: renderPrompt(input.player_input === null ? GRAPH_TALK_GREETING_TURN : GRAPH_TALK_LINE_TURN, names),
        notebook_words: notebookWords(input.reading_age),
      };
    },
    interaction: (input: InputFor<"graph_talk">) =>
      input.player_input === null ? "talk_greeting" : undefined,
  } satisfies TemplateRoleSpec<"graph_talk">,

  graph_search: {
    kind: "template",
    context: (input: InputFor<"graph_search">) =>
      buildGraphSearchAIContext({
        game_id: input.game_id,
        session: input.session,
        blueprint: input.blueprint,
        reading_age: input.reading_age,
        location_id: input.location_id,
        search_query: input.search_query,
        conversation_history: input.conversation_history,
      }),
    vars: (input: InputFor<"graph_search">) => ({
      location_name: locationNameFor(input.blueprint, input.location_id),
      search_target: input.search_query ? `: "${input.search_query}"` : "",
      notebook_words: notebookWords(input.reading_age),
    }),
    // A known outcome has one budget; a judged one states both.
    interaction: (input: InputFor<"graph_search">) => {
      const outcome = buildGraphSearchAIContext(input).graph_search_context?.outcome;
      if (outcome?.kind !== "known") return undefined;
      return outcome.finds ? "search_find" : "search_empty";
    },
  } satisfies TemplateRoleSpec<"graph_search">,

  accusation_start: {
    kind: "template",
    context: (input: InputFor<"accusation_start">) =>
      buildAccusationStartContext({
        game_id: input.game_id,
        session: input.session,
        blueprint: input.blueprint,
        reading_age: input.reading_age,
        forced_by_timeout: input.forced_by_timeout,
        conversation_history: input.conversation_history,
        history_mode: input.history_mode,
      }),
    vars: (input: InputFor<"accusation_start">) => ({
      forced_context: input.forced_context ?? "",
    }),
  } satisfies TemplateRoleSpec<"accusation_start">,

  graph_accusation: {
    kind: "template",
    context: (input: InputFor<"graph_accusation">) => buildGraphAccusationAIContext(input),
    vars: (input: InputFor<"graph_accusation">) => ({ player_input: input.player_input }),
  } satisfies TemplateRoleSpec<"graph_accusation">,

  graph_accusation_round: {
    kind: "template",
    context: (input: InputFor<"graph_accusation_round">) => buildGraphVerdictAIContext(input),
    vars: (input: InputFor<"graph_accusation_round">) => ({ player_input: input.player_input }),
  } satisfies TemplateRoleSpec<"graph_accusation_round">,

  graph_ending: {
    kind: "template",
    context: (input: InputFor<"graph_ending">) => buildGraphVerdictAIContext(input),
    vars: (input: InputFor<"graph_ending">) => ({ player_input: input.player_input }),
  } satisfies TemplateRoleSpec<"graph_ending">,

};

/** The extra guidance the clue graph adds to a shared role's prompt. */
function roleGuidance(role: AIPromptKey): string {
  const guidance = clueGraphRoleGuidance(role);
  return guidance ? `\n\n${guidance}` : "";
}

export type NarrationRoleInput = Extract<RoleRequestInput, { role: NarrationRoleName }>;
export type TemplateRoleInput = Extract<RoleRequestInput, { role: AIPromptKey }>;

/** Every role this module can assemble — used by tests to assert coverage. */
export function allRoleRequestNames(): RoleRequestName[] {
  return Object.keys(REGISTRY) as RoleRequestName[];
}

function specFor(role: RoleRequestName): RoleSpec {
  const spec = REGISTRY[role] as RoleSpec | undefined;
  if (!spec) {
    throw new Error(`Unknown narrator role "${role}"`);
  }
  return spec;
}

/**
 * Build the prompt for a narration role (`intro`, `ambience`) — the outputs
 * that are plain text rather than a role-output contract, at the request's
 * `reading_age`.
 */
export function buildNarrationPrompt(input: NarrationRoleInput): string {
  const spec = specFor(input.role);
  if (spec.kind !== "narration") {
    throw new Error(`Role "${input.role}" is a role-output role — use buildRoleRequest`);
  }
  return spec.prompt(input as never);
}

/**
 * Assemble prompt + context for a role-output request. This and
 * `buildNarrationPrompt` are the ONLY places the reading age is applied, so a
 * caller cannot build a prompt without naming its reader.
 */
export async function buildRoleRequest(input: TemplateRoleInput): Promise<RoleRequest> {
  const spec = specFor(input.role);
  if (spec.kind !== "template") {
    throw new Error(`Role "${input.role}" is a narration role — use buildNarrationPrompt`);
  }

  const context = spec.context(input as never);
  const template = await loadPromptTemplate(input.role, input.reading_age, {
    interaction: spec.interaction?.(input as never),
  });

  return {
    role: input.role,
    prompt: renderPrompt(template, spec.vars(input as never)) + roleGuidance(input.role),
    context,
  };
}
