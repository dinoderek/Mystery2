/**
 * Prompt assembly — the single place a narrator request is built.
 *
 * WHY THIS EXISTS
 *
 * Assembling a narrator request means three things: pick the role, build its
 * context, and render its prompt with the blueprint's `target_age` and
 * `narration_style`. That used to be inlined in every Edge Function handler AND
 * re-implemented by the runtime eval harness, so there were two independent
 * assembly paths. They drifted: the harness called
 * `loadPromptTemplate(role)` with no age and no style, so `clampTargetAge`
 * silently fell back to age 6 and every evaluated prompt was built for the
 * wrong reader while being graded against the blueprint's real age.
 *
 * One assembly path removes that class of bug by construction. Transport —
 * an HTTP call to an Edge Function, or a local CLI replay — becomes a detail
 * layered on top rather than a second implementation.
 *
 * PURITY CONTRACT
 *
 * This module must import only sibling `_shared/*.ts` and must not touch Deno
 * globals, the network, or the database. Node imports it directly (types are
 * stripped on load) so the eval harness can reuse it. Callers derive their own
 * inputs — anything needing a DB read (event history, discovered clues, the
 * next clue to reveal) is passed in, not fetched here.
 */

import type { AIPromptKey } from "./ai-contracts.ts";
import type { InteractionId } from "./age-profile.ts";
import {
  type AIContext,
  type BlueprintClue,
  type BlueprintContext,
  buildAccusationJudgeContext,
  buildAccusationStartContext,
  buildSearchContext,
  buildTalkConversationContext,
  buildTalkEndContext,
  buildTalkStartContext,
  type ConversationFragment,
  findCharacterById,
  findLocationById,
  type SessionSnapshot,
} from "./ai-context.ts";
import {
  buildGameMovePrompt,
  buildGameStartPrompt,
  loadPromptTemplate,
  renderPrompt,
} from "./ai-prompts.ts";

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
  | ({
    role: "ambience";
    destination_id: string;
    has_visited_before: boolean;
    destination_history_json: string;
    destination_characters_json: string;
    destination_sub_locations_json?: string;
  } & CommonInput)
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

// deno-lint-ignore no-explicit-any -- the registry is heterogeneous by design;
// each entry is checked against its own input variant at the call sites below.
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
      return buildGameMovePrompt({
        target_age: input.blueprint.metadata.target_age,
        destination_name: destination.name,
        destination_description: destination.description,
        has_visited_before: input.has_visited_before,
        destination_history_json: input.destination_history_json,
        destination_characters_json: input.destination_characters_json,
        destination_sub_locations_json: input.destination_sub_locations_json,
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

  const template = await loadPromptTemplate(
    input.role,
    input.blueprint.metadata.target_age,
    {
      interaction: spec.interaction?.(input as never),
      narrationStyle: input.blueprint.metadata.narration_style ?? null,
    },
  );

  return {
    role: input.role,
    prompt: renderPrompt(template, spec.vars(input as never)),
    context: spec.context(input as never),
  };
}
