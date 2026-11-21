/**
 * Prompt assembly — the single place a narrator request is built.
 *
 * WHY THIS EXISTS
 *
 * Assembling a narrator request means three things: pick the role, build its
 * context, and render its prompt with the blueprint's `target_age` and
 * `narration_style`. That used to be inlined in every endpoint handler AND
 * re-implemented by the runtime eval harness, so there were two independent
 * assembly paths. They drifted: the harness called
 * `loadPromptTemplate(role)` with no age and no style, so `clampTargetAge`
 * silently fell back to age 6 and every evaluated prompt was built for the
 * wrong reader while being graded against the blueprint's real age.
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

import type { AIPromptKey } from "./ai-contracts.ts";
import type { InteractionId } from "../../shared/src/age-profile.ts";
import {
  type AIContext,
  type BlueprintClue,
  type BlueprintContext,
  buildAccusationJudgeContext,
  buildAccusationStartContext,
  buildArrivalCharacterContexts,
  buildGraphSearchAIContext,
  buildGraphTalkAIContext,
  buildSearchContext,
  buildTalkConversationContext,
  buildTalkEndContext,
  buildTalkStartContext,
  type ConversationFragment,
  findCharacterById,
  findLocationById,
  selectLastArrivalNarration,
  selectLocationConversationHistory,
  type SessionSnapshot,
} from "./ai-context.ts";
import { buildDiscoveredClueIdSet, isSpotHidden } from "./clue-discovery.ts";
import {
  buildGameMovePrompt,
  buildGameStartPrompt,
  loadPromptTemplate,
  renderPrompt,
} from "./ai-prompts.ts";
import { talkPromptProfile } from "./talk-prompt.ts";
import { msfRoleGuidance } from "./msf-context.ts";
import { clueGraphRoleGuidance } from "./clue-graph/judge-guidance.ts";
import { GRAPH_TALK_EARLIER_LINES, GRAPH_TALK_GREETING_TURN, GRAPH_TALK_LINE_TURN } from "./clue-graph/prompts.ts";
import { linesThisConversation, playOf } from "./clue-graph/history.ts";
import { visibleSpots } from "./clue-graph/play.ts";

/**
 * The two narrator outputs that are plain narration rather than a role-output
 * contract: they call `generateNarration` with a code-built prompt and have no
 * context object. Named for their age-profile interaction so every narrator
 * output in the system has one name here.
 */
export type NarrationRoleName = "intro" | "ambience";

export type RoleRequestName = AIPromptKey | NarrationRoleName;

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
  conversation_history?: ConversationFragment[];
}

interface SessionInput extends CommonInput {
  session: SessionSnapshot;
}

/**
 * Shared shape of both search roles. They are listed as separate union members
 * below rather than one member with a union `role`, because `Extract` only
 * narrows on a single literal — a member typed
 * `role: "search_bare" | "search_targeted"` resolves to `never`.
 */
interface SearchInputFields extends SessionInput {
  location_id: string;
  revealed_clue_ids: string[];
  discovered_clue_ids?: string[];
  next_clue: BlueprintClue | null;
  search_query?: string | null;
}

export type RoleRequestInput =
  | ({ role: "intro" } & CommonInput)
  // Everything else an arrival needs — whether the place was visited before,
  // what happened there, who is present and what the player already holds — is
  // derived from `conversation_history` (the whole session's events; empty for
  // `game-enter`), so the endpoints and the eval harness cannot disagree on it.
  | ({ role: "ambience"; destination_id: string } & CommonInput)
  | ({ role: "talk_start"; character_id: string; location_id: string } & SessionInput)
  | ({
    role: "talk_conversation";
    character_id: string;
    location_id: string;
    player_input: string;
  } & SessionInput)
  | ({ role: "talk_end"; character_id: string; location_id: string } & SessionInput)
  | ({ role: "search_bare" } & SearchInputFields)
  | ({ role: "search_targeted" } & SearchInputFields)
  // A clue-graph case's turns: the state comes from the history.
  | ({
    role: "graph_talk";
    character_id: string;
    location_id: string;
    /** Null for the greeting. */
    player_input: string | null;
  } & SessionInput)
  | ({ role: "graph_search"; location_id: string; search_query: string | null } & SessionInput)
  | ({
    role: "accusation_start";
    forced_by_timeout?: boolean;
    forced_context?: string;
    history_mode?: "all" | "none";
  } & SessionInput)
  | ({
    role: "accusation_judge";
    player_input: string;
    round: number;
    history_mode?: "all" | "none";
  } & SessionInput);

type InputFor<R extends RoleRequestName> = Extract<RoleRequestInput, { role: R }>;

/**
 * Which search prompt a search turn uses. Targeted searches carry free text;
 * bare searches do not. Kept here rather than in the handler so the harness
 * resolves it identically.
 */
export function resolveSearchRole(searchQuery?: string | null): "search_bare" | "search_targeted" {
  return searchQuery && searchQuery.trim().length > 0 ? "search_targeted" : "search_bare";
}

/**
 * Which accusation prompt an accusation turn uses. Reasoning means the judge is
 * adjudicating; no reasoning means the scene is being opened.
 */
export function resolveAccusationRole(
  playerReasoning?: string | null,
): "accusation_start" | "accusation_judge" {
  return playerReasoning && playerReasoning.trim().length > 0
    ? "accusation_judge"
    : "accusation_start";
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
      buildGameStartPrompt({
        target_age: input.blueprint.metadata.target_age,
        premise: input.blueprint.narrative.premise,
        narration_style: input.blueprint.metadata.narration_style ?? null,
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
      // A spot nothing has pointed to yet is not advertised (`isSpotHidden`);
      // a clue-graph case shows a hidden spot once its pointer is held.
      const discovered = buildDiscoveredClueIdSet(history);
      const graph = input.blueprint.clue_graph;
      const shown = graph ? new Set(visibleSpots(graph, playOf(graph, history), destination.id)) : null;
      const subLocations = (destination.sub_locations ?? [])
        .filter((sl) => (shown ? shown.has(sl.name) : !isSpotHidden(sl, discovered)))
        .map((sl) => ({ name: sl.name }));
      return buildGameMovePrompt({
        target_age: input.blueprint.metadata.target_age,
        destination_name: destination.name,
        destination_description: destination.description,
        has_visited_before: selectLocationConversationHistory(history, destination.id).length > 0,
        last_arrival_narration: lastArrival,
        destination_characters_json: JSON.stringify(
          buildArrivalCharacterContexts(input.blueprint, destination.id, history),
        ),
        destination_sub_locations_json:
          subLocations.length > 0 ? JSON.stringify(subLocations) : undefined,
        narration_style: input.blueprint.metadata.narration_style ?? null,
      });
    },
  } satisfies NarrationRoleSpec<"ambience">,

  talk_start: {
    kind: "template",
    context: (input: InputFor<"talk_start">) =>
      buildTalkStartContext({
        game_id: input.game_id,
        session: input.session,
        blueprint: input.blueprint,
        character_id: input.character_id,
        location_id: input.location_id,
        conversation_history: input.conversation_history,
      }),
    vars: (input: InputFor<"talk_start">) => ({
      character_name: characterNameFor(input.blueprint, input.character_id),
      location_name: locationNameFor(input.blueprint, input.location_id),
      target_age: input.blueprint.metadata.target_age,
    }),
  } satisfies TemplateRoleSpec<"talk_start">,

  talk_conversation: {
    kind: "template",
    context: (input: InputFor<"talk_conversation">) =>
      buildTalkConversationContext({
        game_id: input.game_id,
        session: input.session,
        blueprint: input.blueprint,
        character_id: input.character_id,
        player_input: input.player_input,
        location_id: input.location_id,
        conversation_history: input.conversation_history,
      }),
    vars: (input: InputFor<"talk_conversation">) => ({
      character_name: characterNameFor(input.blueprint, input.character_id),
      player_input: input.player_input,
      target_age: input.blueprint.metadata.target_age,
    }),
  } satisfies TemplateRoleSpec<"talk_conversation">,

  talk_end: {
    kind: "template",
    context: (input: InputFor<"talk_end">) =>
      buildTalkEndContext({
        game_id: input.game_id,
        session: input.session,
        blueprint: input.blueprint,
        character_id: input.character_id,
        location_id: input.location_id,
        conversation_history: input.conversation_history,
      }),
    vars: (input: InputFor<"talk_end">) => ({
      character_name: characterNameFor(input.blueprint, input.character_id),
      location_name: locationNameFor(input.blueprint, input.location_id),
      target_age: input.blueprint.metadata.target_age,
    }),
  } satisfies TemplateRoleSpec<"talk_end">,

  search_bare: {
    kind: "template",
    context: (input: InputFor<"search_bare">) => buildSearchContextFrom(input),
    vars: (input: InputFor<"search_bare">) => searchVars(input),
    // Bare search defaults to the lean "nothing found" budget; when the backend
    // already knows a clue will be revealed, use the roomier clue-reveal budget
    // so the payoff is not squeezed.
    interaction: (input: InputFor<"search_bare">) =>
      input.next_clue ? "search_find" : undefined,
  } satisfies TemplateRoleSpec<"search_bare">,

  search_targeted: {
    kind: "template",
    context: (input: InputFor<"search_targeted">) => buildSearchContextFrom(input),
    vars: (input: InputFor<"search_targeted">) => searchVars(input),
  } satisfies TemplateRoleSpec<"search_targeted">,

  graph_talk: {
    kind: "template",
    context: (input: InputFor<"graph_talk">) =>
      buildGraphTalkAIContext({
        game_id: input.game_id,
        session: input.session,
        blueprint: input.blueprint,
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
        location_id: input.location_id,
        search_query: input.search_query,
        conversation_history: input.conversation_history,
      }),
    vars: (input: InputFor<"graph_search">) => ({
      location_name: locationNameFor(input.blueprint, input.location_id),
      search_target: input.search_query ? `: "${input.search_query}"` : "",
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
        forced_by_timeout: input.forced_by_timeout,
        conversation_history: input.conversation_history,
        history_mode: input.history_mode,
      }),
    vars: (input: InputFor<"accusation_start">) => ({
      forced_context: input.forced_context ?? "",
      target_age: input.blueprint.metadata.target_age,
    }),
  } satisfies TemplateRoleSpec<"accusation_start">,

  accusation_judge: {
    kind: "template",
    context: (input: InputFor<"accusation_judge">) =>
      buildAccusationJudgeContext({
        game_id: input.game_id,
        session: input.session,
        blueprint: input.blueprint,
        player_input: input.player_input,
        round: input.round,
        conversation_history: input.conversation_history,
        history_mode: input.history_mode,
      }),
    vars: (input: InputFor<"accusation_judge">) => ({
      forced_context: "",
      target_age: input.blueprint.metadata.target_age,
    }),
  } satisfies TemplateRoleSpec<"accusation_judge">,
};

type SearchInput = SearchInputFields;

function buildSearchContextFrom(input: SearchInput): AIContext {
  return buildSearchContext({
    game_id: input.game_id,
    session: input.session,
    blueprint: input.blueprint,
    location_id: input.location_id,
    revealed_clue_ids: input.revealed_clue_ids,
    discovered_clue_ids: input.discovered_clue_ids,
    next_clue: input.next_clue,
    search_query: input.search_query,
    conversation_history: input.conversation_history,
  });
}

function searchVars(input: SearchInput) {
  return {
    location_name: locationNameFor(input.blueprint, input.location_id),
    target_age: input.blueprint.metadata.target_age,
    search_query: input.search_query ?? "",
  };
}

/** The extra guidance a case format adds to a shared role's prompt. */
function roleGuidance(blueprint: BlueprintContext, role: AIPromptKey): string {
  if (blueprint.msf) return `\n\n${msfRoleGuidance(role)}`;
  const guidance = blueprint.clue_graph ? clueGraphRoleGuidance(role) : "";
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
 * that are plain text rather than a role-output contract. Applies the
 * blueprint's `target_age` and `narration_style` via the code-built prompt
 * builders.
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
 * `buildNarrationPrompt` are the ONLY places `target_age` and
 * `narration_style` are applied, so a caller cannot build a prompt for the
 * wrong reader.
 */
export async function buildRoleRequest(input: TemplateRoleInput): Promise<RoleRequest> {
  const spec = specFor(input.role);
  if (spec.kind !== "template") {
    throw new Error(`Role "${input.role}" is a narration role — use buildNarrationPrompt`);
  }

  const context = spec.context(input as never);
  // A conversation's rules are chosen by what its character has.
  const character = input.role === "talk_conversation" ? context.talk_context?.active_character : undefined;
  const template = await loadPromptTemplate(
    input.role,
    input.blueprint.metadata.target_age,
    {
      interaction: spec.interaction?.(input as never),
      narrationStyle: input.blueprint.metadata.narration_style ?? null,
      talkProfile: character ? talkPromptProfile(character) : undefined,
    },
  );

  return {
    role: input.role,
    prompt: renderPrompt(template, spec.vars(input as never)) + roleGuidance(input.blueprint, input.role),
    context,
  };
}
