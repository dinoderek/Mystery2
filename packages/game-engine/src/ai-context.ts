import type { AIRoleName } from "./ai-contracts.ts";
import type { MsfCaseFile } from "../../shared/src/msf-case.ts";
import { evaluateMysteryStructure } from "../../shared/src/mystery-structure-progress.ts";
import { msfCharacterKnowledge } from "./msf-context.ts";
import {
  buildDiscoveredClueIdSet,
  buildKnownCluesWithOrigin,
  buildPathCoverage,
  type ClueRequires,
  isClueUnlocked,
  isSpotHidden,
  type KnownClueWithOrigin,
  type PathCoverage,
} from "./clue-discovery.ts";
import { buildCharacterState, FALLBACK_VISITS, gateClueIds, isAgendaFullyEarned, safeSteps } from "./character-state.ts";
import { type ClueRef, type ClueWorld, mapClueIdsToClues } from "./clues.ts";
import { namedHiddenSpot } from "./search-target.ts";
import type { ClueGraphCase } from "../../shared/src/clue-graph-schema.ts";
import { playOf } from "./clue-graph/history.ts";
import { supportedConclusions } from "./clue-graph/play.ts";
import {
  buildGraphSearchContext,
  buildGraphTalkContext,
  type GraphSearchContext,
  type GraphTalkContext,
} from "./clue-graph/narrator-context.ts";

export interface BlueprintClue {
  id: string;
  text: string;
  about_character_id?: string;
  hint_location_id?: string;
  hint_sub_location_id?: string;
  requires?: ClueRequires | null;
}

export interface BlueprintAgenda {
  type: string;
  strategy: string;
  priority: string;
  details: string;
  target_character_id?: string;
  gated_clue_id?: string;
  condition?: string;
  yields_to_clue_ids?: string[];
  // self_protect only: each fact that breaks the cover story, the clues that show
  // it, and what it earns.
  parts?: BlueprintAgendaPart[];
  confession?: string;
  // The actual_actions sequences this cover hides from the speaker.
  hides_steps?: number[];
}

export interface BlueprintAgendaPart {
  // Any one of these clues, used, earns the part.
  clue_ids: string[];
  shows: string;
  reaction: string;
  // The actual_actions sequences this reaction owns up to, once earned.
  concedes_steps?: number[];
}

export type BlueprintTellTrigger =
  | { kind: "always" }
  | { kind: "condition"; condition: string }
  | { kind: "clue"; clue_ids: string[] };

export interface BlueprintTell {
  id: string;
  text: string;
  trigger: BlueprintTellTrigger;
}

export interface BlueprintActualAction {
  sequence: number;
  summary: string;
}

export interface BlueprintReasoningPath {
  id: string;
  summary: string;
  description?: string;
  location_clue_ids: string[];
  character_clue_ids: string[];
}

export interface BlueprintContext {
  msf?: MsfCaseFile;
  clue_graph?: ClueGraphCase;
  metadata: {
    title: string;
    one_liner: string;
    target_age: number;
    time_budget?: number;
    image_id?: string;
    // Optional narration voice for this mystery, layered on top of the
    // standard narrator style (see buildStyleGuidance in ai-prompts.ts).
    narration_style?: string;
  };
  narrative: {
    premise: string;
    starting_knowledge?: {
      mystery_summary: string;
      locations: Array<{ location_id: string; summary: string }>;
      characters: Array<{ character_id: string; summary: string }>;
    };
  };
  world: {
    starting_location_id: string;
    locations: Array<{
      id: string;
      name: string;
      description: string;
      clues: BlueprintClue[];
      location_image_id?: string;
      sub_locations?: Array<{
        id: string;
        name: string;
        hint: string;
        clues: BlueprintClue[];
      }>;
    }>;
    characters: Array<{
      id: string;
      first_name: string;
      last_name: string;
      location_id: string;
      sex: "male" | "female";
      appearance: string;
      background: string;
      personality: string;
      initial_attitude_towards_investigator: string;
      stated_alibi: string | null;
      motive: string | null;
      is_culprit: boolean;
      portrait_image_id?: string;
      clues: BlueprintClue[];
      flavor_knowledge: string[];
      actual_actions: BlueprintActualAction[];
      agendas?: BlueprintAgenda[];
      tells?: BlueprintTell[];
    }>;
  };
  ground_truth: {
    what_happened: string;
    why_it_happened: string;
    timeline: string[];
  };
  solution_paths: BlueprintReasoningPath[];
  red_herrings: BlueprintReasoningPath[];
  suspect_elimination_paths: BlueprintReasoningPath[];
}

export interface SessionSnapshot {
  mode: "explore" | "talk" | "accuse" | "ended";
  current_location_id: string;
  current_talk_character_id: string | null;
  time_remaining: number;
}

export interface ConversationFragment {
  sequence: number;
  event_type: string;
  actor: string;
  narration: string;
  payload?: Record<string, unknown> | null;
}

export interface SharedMysteryContext {
  target_age: number;
}

// The role a context is built for: an output-contract role, or `ambience` —
// arrival narration, which has no output contract but does have a context.
export type ContextRoleName = AIRoleName | "ambience";

export interface MoveContext {
  destination_id: string;
  destination_name: string;
  destination_description: string;
  has_visited_before: boolean;
  // What the last arrival here said about the place, so a return stays consistent.
  last_arrival_narration: string | null;
  destination_characters: ArrivalCharacterContext[];
}

// Who is standing at a destination, as much as an arrival can use: how they
// look and carry themselves, never what they know or did.
export interface ArrivalCharacterContext {
  id: string;
  first_name: string;
  last_name: string;
  sex: "male" | "female";
  appearance: string;
  personality: string;
  initial_attitude_towards_investigator: string;
  // Each agenda still in play, in priority order, as the manner it gives them.
  manner: string[];
  // Only tells that need nothing from the player: `always` ones.
  tells: string[];
}

// A clue as search shows it: without its gate. Every clue search sees is one
// the engine has already let through (unlocked, or admitted by a search that
// names its spot), so the gate's reason would only read as a reason to withhold.
export type SearchClue = Omit<BlueprintClue, "requires">;

export interface SubLocationContext {
  id: string;
  name: string;
  hint: string;
  clues: SearchClue[];
  unrevealed_clues: SearchClue[];
  has_unrevealed_clues: boolean;
}

export interface SearchContext {
  location_id: string;
  location_name: string;
  location_description: string;
  clues: SearchClue[];
  revealed_clue_ids: string[];
  next_clue: SearchClue | null;
  sub_locations: SubLocationContext[];
  search_query: string | null;
}

export interface TalkLocationSummary {
  id: string;
  name: string;
  description: string;
}

// What ANY character context may say about a character other than the active
// one: identity, visible appearance, and the player-facing summary from
// narrative.starting_knowledge. Private authored material (background,
// personality, alibi, motive, clues, agendas, ...) is reserved for the active
// character's own private context — cross-character knowledge travels only via
// explicit clues (about_character_id).
export interface TalkCharacterPublicSummary {
  id: string;
  first_name: string;
  last_name: string;
  location_id: string;
  sex: "male" | "female";
  appearance: string;
  // Player-facing public knowledge from narrative.starting_knowledge; null
  // when the blueprint has no entry for this character.
  public_summary: string | null;
}

// A character clue as presented to the narrator during conversation. Carries the
// gate's `requires_rationale` (the in-fiction reason it is withheld) and
// precomputed flags so the model does not have to do set math. Clue ids of
// prerequisites are intentionally NOT sent: the rationale says what the player
// must use, and the narrator judges use from the conversation.
export interface TalkClueContext {
  id: string;
  text: string;
  about_character_id?: string;
  hint_location_id?: string;
  requires_rationale: string | null;
  // Why it is locked: `pointer` (an earlier clue tells the player what to
  // raise) or `leverage` (the character must be shown it). Null when ungated.
  requires_kind: ClueRequires["kind"] | null;
  // The player holds this clue's prerequisites, so they are able to use them.
  // A precondition, never permission: the clue is earned only once they do.
  // Null for an ungated clue.
  player_can_use_prerequisites: boolean | null;
  // The player already discovered this clue; restating it reveals nothing new.
  known_to_player: boolean;
}

// A self-protect part as the narrator sees it: what earns it and what it shows.
// Its reaction is sent only once earned, as part of the character's story.
export interface TalkAgendaPartContext {
  clue_ids: string[];
  shows: string;
  earned: boolean;
}

// An agenda as the narrator sees it. A self-protect agenda's confession is sent
// only once every part is earned, and is null until then.
export type TalkAgendaContext = Omit<BlueprintAgenda, "parts" | "confession" | "hides_steps"> & {
  parts?: TalkAgendaPartContext[];
  confession?: string | null;
};

// What the player has done to this character so far, rebuilt from the session's
// events across every visit (`character-state.ts`). It only grows.
export interface TalkCharacterStateContext {
  used_clue_ids: string[];
  // The stated alibi, then each earned reaction in the order it was earned.
  current_story: string[];
  // Denials and claims the character made, newest last.
  commitments: string[];
  visits_with_questions: number;
  // The player has questioned this character in enough separate visits that the
  // repeated-asking fallback may give up a partial truth or a gated clue.
  fallback_open: boolean;
}

export interface TalkCharacterPrivateContext extends TalkCharacterPublicSummary {
  msf?: ReturnType<typeof msfCharacterKnowledge>;
  background: string;
  personality: string;
  initial_attitude_towards_investigator: string;
  stated_alibi: string | null;
  motive: string | null;
  clues: TalkClueContext[];
  flavor_knowledge: string[];
  // Only the steps safe to say (`safeSteps`): what no cover hides, and what an
  // earned part or confession has given up.
  actual_actions: BlueprintActualAction[];
  agendas: TalkAgendaContext[];
  tells: BlueprintTell[];
  player_known_clues: Array<{ id: string; text: string }>;
  // The clues the player could use on this character (what earns a part or
  // opens a gate), each with whether they hold it. Only these are reported used.
  gate_clues: Array<{ id: string; held: boolean }>;
  state: TalkCharacterStateContext;
}

export interface TalkContext {
  active_location_id: string;
  active_location_name: string;
  active_location_description: string | null;
  locations: TalkLocationSummary[];
  characters: TalkCharacterPublicSummary[];
  active_character: TalkCharacterPrivateContext;
}

export interface AccusationStartContext {
  current_location_id: string | null;
  current_location_name: string | null;
  current_location_description: string | null;
  // Spoiler-safe public roster so the narrator can name the suspects and pick
  // grounded pronouns (sex is explicit per character) when framing the scene.
  characters: TalkCharacterPublicSummary[];
}

// The judge receives the whole blueprint, so it knows every clue that EXISTS.
// What it cannot infer reliably from a long transcript is which of those the
// investigator actually earned — that is what these two fields carry.
/** What a clue-graph investigation has earned, derived from the events. */
export interface ClueGraphProgress {
  /** Conclusions whose rule holds over the clues held and not taken back. */
  supported_conclusions: Array<{ id: string; text: string }>;
  /** Whether a supported conclusion names the culprit. Alone it never wins. */
  culprit_supported: boolean;
  /** Statements the investigator has had taken back. */
  taken_back: string[];
}

export interface AccusationJudgeContext {
  msf_progress?: ReturnType<typeof evaluateMysteryStructure>;
  clue_graph_progress?: ClueGraphProgress;
  round: number;
  full_blueprint: BlueprintContext;
  // Every clue discovered this session, in discovery order. The only thing
  // separating what exists in the blueprint from what the player holds.
  player_known_clues: KnownClueWithOrigin[];
  // That set intersected with each reasoning path, precomputed. Lets the judge
  // tell a near-complete case from a red-herring-led one from a guess.
  path_coverage: PathCoverage[];
}

// A type alias rather than an interface on purpose: only an alias gets an
// implicit index signature, and every provider takes the context as a
// `Record<string, unknown>` to serialise.
export type AIContext = {
  game_id: string;
  role_name: ContextRoleName;
  mode: SessionSnapshot["mode"];
  forced_by_timeout: boolean;
  location_id: string | null;
  character_id: string | null;
  player_input: string | null;
  conversation_history: ConversationFragment[];
  shared_mystery_context: SharedMysteryContext;
  move_context: MoveContext | null;
  search_context: SearchContext | null;
  talk_context: TalkContext | null;
  accusation_start_context: AccusationStartContext | null;
  accusation_judge_context: AccusationJudgeContext | null;
  // Present only for a clue-graph case's talk and search (`clue-graph/`).
  graph_talk_context?: GraphTalkContext;
  graph_search_context?: GraphSearchContext;
};

interface BuildContextInput {
  game_id: string;
  role_name: ContextRoleName;
  session: SessionSnapshot;
  forced_by_timeout?: boolean;
  blueprint: BlueprintContext;
  location_id?: string | null;
  character_id?: string | null;
  player_input?: string | null;
  conversation_history?: ConversationFragment[];
  accusation_history_mode?: "all" | "none";
  move_context?: MoveContext | null;
  search_context?: SearchContext | null;
  talk_context?: TalkContext | null;
  accusation_start_context?: AccusationStartContext | null;
  accusation_judge_context?: AccusationJudgeContext | null;
  graph_talk_context?: GraphTalkContext;
  graph_search_context?: GraphSearchContext;
}

export function findLocationById(
  blueprint: BlueprintContext,
  locationId: string,
): BlueprintContext["world"]["locations"][number] | undefined {
  return blueprint.world.locations.find((l) => l.id === locationId);
}

export function findCharacterById(
  blueprint: BlueprintContext,
  characterId: string,
): BlueprintContext["world"]["characters"][number] | undefined {
  return blueprint.world.characters.find((c) => c.id === characterId);
}

function readPayloadField(
  payload: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!payload) {
    return null;
  }

  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readPayloadStringArray(
  payload: Record<string, unknown> | null | undefined,
  key: string,
): string[] {
  if (!payload) {
    return [];
  }

  const value = payload[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string =>
    typeof entry === "string" && entry.trim().length > 0
  );
}

function sanitizePayload(
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!payload) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};
  const stringFields = [
    "character_id",
    "character_name",
    "character",
    "location_id",
    "location_name",
    "destination",
    "player_input",
    "revealed_clue_text",
    "revealed_clue_id",
  ];

  for (const field of stringFields) {
    const value = readPayloadField(payload, field);
    if (value !== null) {
      sanitized[field] = value;
    }
  }

  const revealedClueIds = readPayloadStringArray(payload, "revealed_clue_ids");
  if (revealedClueIds.length > 0) {
    sanitized.revealed_clue_ids = revealedClueIds;
  }

  const revealedClues = readPayloadStringArray(payload, "revealed_clues");
  if (revealedClues.length > 0) {
    sanitized.revealed_clues = revealedClues;
  }

  const clueIndex = payload.revealed_clue_index;
  if (typeof clueIndex === "number" && Number.isInteger(clueIndex)) {
    sanitized.revealed_clue_index = clueIndex;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeConversationHistory(
  conversationHistory: ConversationFragment[],
): ConversationFragment[] {
  return conversationHistory.map((entry) => ({
    sequence: entry.sequence,
    event_type: entry.event_type,
    actor: entry.actor,
    narration: entry.narration,
    ...(sanitizePayload(entry.payload) ? { payload: sanitizePayload(entry.payload) } : {}),
  }));
}

function filterCharacterHistory(
  conversationHistory: ConversationFragment[],
  characterId: string,
): ConversationFragment[] {
  return conversationHistory.filter((entry) => {
    if (
      entry.event_type !== "talk" &&
      entry.event_type !== "ask" &&
      entry.event_type !== "end_talk"
    ) {
      return false;
    }

    const payloadCharacterId =
      readPayloadField(entry.payload, "character_id") ??
      readPayloadField(entry.payload, "character_name") ??
      readPayloadField(entry.payload, "character");
    return payloadCharacterId === characterId || entry.actor === characterId;
  });
}

function filterLocationHistory(
  conversationHistory: ConversationFragment[],
  locationId: string,
): ConversationFragment[] {
  return conversationHistory.filter((entry) => {
    const payloadLocationId =
      readPayloadField(entry.payload, "location_id") ??
      readPayloadField(entry.payload, "location_name") ??
      readPayloadField(entry.payload, "destination");
    return payloadLocationId === locationId;
  });
}

function buildSharedMysteryContext(
  blueprint: BlueprintContext,
): SharedMysteryContext {
  return {
    target_age: blueprint.metadata.target_age,
  };
}

function buildTalkLocationSummaries(
  blueprint: BlueprintContext,
): TalkLocationSummary[] {
  return blueprint.world.locations.map((location) => ({
    id: location.id,
    name: location.name,
    description: location.description,
  }));
}

export function buildTalkCharacterPublicSummaries(
  blueprint: BlueprintContext,
): TalkCharacterPublicSummary[] {
  const publicSummaryByCharacterId = new Map(
    (blueprint.narrative.starting_knowledge?.characters ?? []).map(
      (entry) => [entry.character_id, entry.summary] as const,
    ),
  );

  return blueprint.world.characters.map((character) => ({
    id: character.id,
    first_name: character.first_name,
    last_name: character.last_name,
    location_id: character.location_id,
    sex: character.sex,
    appearance: character.appearance,
    public_summary: publicSummaryByCharacterId.get(character.id) ?? null,
  }));
}

export function buildPlayerKnownClues(
  blueprint: ClueWorld,
  conversationHistory: ConversationFragment[],
): ClueRef[] {
  const clueIds = buildDiscoveredClueIdSet(conversationHistory);

  if (clueIds.size === 0) return [];

  return mapClueIdsToClues(blueprint, clueIds);
}

type BlueprintCharacter = BlueprintContext["world"]["characters"][number];

function buildTalkAgendas(character: BlueprintCharacter, state: ReturnType<typeof buildCharacterState>): TalkAgendaContext[] {
  return (character.agendas ?? []).map((agenda, agendaIndex) => {
    const { parts: authoredParts, confession, ...rest } = agenda;
    if (agenda.type !== "self_protect") return rest;
    // The hidden steps decide what reaches actual_actions; the list itself stays back.
    delete rest.hides_steps;
    const parts = authoredParts ?? [];
    return {
      ...rest,
      parts: parts.map((part, partIndex) => ({
        clue_ids: part.clue_ids,
        shows: part.shows,
        earned: state.earned_parts.some(
          (earned) => earned.agenda_index === agendaIndex && earned.part_index === partIndex,
        ),
      })),
      confession: isAgendaFullyEarned(state, agendaIndex, parts.length) ? confession ?? null : null,
    };
  });
}

function buildTalkCharacterPrivateContext(
  blueprint: BlueprintContext,
  characterId: string,
  playerKnownClues: Array<{ id: string; text: string }>,
  conversationHistory: ConversationFragment[],
  options: { asking_now?: boolean } = {},
): TalkCharacterPrivateContext {
  const character = blueprint.world.characters.find(
    (entry) => entry.id === characterId,
  );
  if (!character) {
    throw new Error(`Character ${characterId} not found in blueprint`);
  }

  const publicSummary =
    blueprint.narrative.starting_knowledge?.characters.find(
      (entry) => entry.character_id === characterId,
    )?.summary ?? null;

  const discoveredSet = new Set(playerKnownClues.map((c) => c.id));
  const clues: TalkClueContext[] = character.clues.filter((clue) => {
    const node = blueprint.msf?.structure.nodes[clue.id];
    return node?.kind !== "clue" || node.requires?.kind !== "physical" || isClueUnlocked(clue, discoveredSet);
  }).map((clue) => ({
    id: clue.id,
    text: clue.text,
    about_character_id: clue.about_character_id,
    hint_location_id: clue.hint_location_id,
    requires_rationale: clue.requires?.rationale ?? null,
    requires_kind: clue.requires?.kind ?? null,
    player_can_use_prerequisites: clue.requires ? isClueUnlocked(clue, discoveredSet) : null,
    known_to_player: discoveredSet.has(clue.id),
  }));
  const state = buildCharacterState(character, conversationHistory, options);
  const msf = blueprint.msf ? msfCharacterKnowledge(blueprint.msf.structure, character.id, discoveredSet, state.used_clue_ids) : undefined;

  return {
    id: character.id,
    first_name: character.first_name,
    last_name: character.last_name,
    location_id: character.location_id,
    sex: character.sex,
    appearance: character.appearance,
    public_summary: publicSummary,
    background: character.background,
    personality: character.personality,
    initial_attitude_towards_investigator:
      character.initial_attitude_towards_investigator,
    stated_alibi: character.stated_alibi,
    motive: character.motive,
    clues,
    flavor_knowledge: character.flavor_knowledge,
    actual_actions: safeSteps(character, state, character.actual_actions),
    agendas: buildTalkAgendas(character, state),
    tells: character.tells ?? [],
    player_known_clues: playerKnownClues,
    gate_clues: [...new Set([...gateClueIds(character), ...(blueprint.msf ? discoveredSet : [])])].map((id) => ({ id, held: discoveredSet.has(id) })),
    state: {
      used_clue_ids: state.used_clue_ids,
      current_story: msf ? [...msf.claims.map((claim) => `${claim.disproved ? "Evidence disproves my earlier claim: " : ""}${claim.value ? "" : "It is false that "}${claim.text}`), ...state.commitments] : state.current_story,
      commitments: state.commitments,
      visits_with_questions: state.visits_with_questions,
      fallback_open: state.visits_with_questions >= FALLBACK_VISITS,
    },
    ...(msf ? { msf } : {}),
  };
}

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

// An agenda as the manner it gives a character before anyone asks them
// anything. Built from its type and target only: strategy and details name the
// secret behind it.
function agendaManner(
  agenda: BlueprintAgenda,
  sex: "male" | "female",
  nameOf: (id: string) => string,
): string {
  const target = agenda.target_character_id ? nameOf(agenda.target_character_id) : "someone";
  switch (agenda.type) {
    case "self_protect":
      return `keeps attention away from ${sex === "female" ? "herself" : "himself"}`;
    case "protect_other":
      return `protective of ${target}`;
    case "implicate_other":
      return `would rather the investigator looked at ${target}`;
    default:
      return "holding something back";
  }
}

// An agenda the player has already broken no longer shapes the manner: a
// confessed cover, an agenda that yielded to a used clue, a reveal whose clue
// has been given. Protecting or blaming someone has no such end, as in talk, so
// it stays in the manner.
function isAgendaSpent(
  agenda: BlueprintAgenda,
  agendaIndex: number,
  state: ReturnType<typeof buildCharacterState>,
  discovered: Set<string>,
): boolean {
  if (agenda.type === "self_protect") {
    return isAgendaFullyEarned(state, agendaIndex, agenda.parts?.length ?? 0);
  }
  if (agenda.yields_to_clue_ids?.some((id) => state.used_clue_ids.includes(id))) return true;
  return agenda.gated_clue_id !== undefined && discovered.has(agenda.gated_clue_id);
}

/**
 * Every character standing at a location, as arrival narration needs them:
 * looks, personality, attitude, the manner their live agendas give them and
 * their `always` tells. Nobody has asked anything yet, so nothing they know,
 * did or claim is passed, and neither is a tell that waits on the player.
 */
export function buildArrivalCharacterContexts(
  blueprint: BlueprintContext,
  locationId: string,
  conversationHistory: ConversationFragment[],
): ArrivalCharacterContext[] {
  const present = blueprint.world.characters.filter(
    (character) => character.location_id === locationId,
  );
  if (present.length === 0) return [];

  const discovered = buildDiscoveredClueIdSet(conversationHistory);
  const nameOf = (id: string) =>
    blueprint.world.characters.find((entry) => entry.id === id)?.first_name ?? "someone";
  return present.map((character) => {
    const state = buildCharacterState(character, conversationHistory);
    const manner = (character.agendas ?? [])
      .map((agenda, index) => ({ agenda, index }))
      .filter(({ agenda, index }) => !isAgendaSpent(agenda, index, state, discovered))
      .sort((a, b) =>
        (PRIORITY_ORDER[a.agenda.priority] ?? 3) - (PRIORITY_ORDER[b.agenda.priority] ?? 3)
      )
      .map(({ agenda }) => agendaManner(agenda, character.sex, nameOf));
    return {
      id: character.id,
      first_name: character.first_name,
      last_name: character.last_name,
      sex: character.sex,
      appearance: character.appearance,
      personality: character.personality,
      initial_attitude_towards_investigator: character.initial_attitude_towards_investigator,
      manner: [...new Set(manner)],
      tells: (character.tells ?? [])
        .filter((tell) => tell.trigger.kind === "always")
        .map((tell) => tell.text),
    };
  });
}

/** The narration of the most recent arrival at a location, or null if none. */
export function selectLastArrivalNarration(
  conversationHistory: ConversationFragment[],
  locationId: string,
): string | null {
  const arrivals = filterLocationHistory(conversationHistory, locationId)
    .filter((entry) => entry.event_type === "move");
  return arrivals.at(-1)?.narration ?? null;
}

function buildTalkContext(
  blueprint: BlueprintContext,
  locationId: string,
  characterId: string,
  conversationHistory: ConversationFragment[],
  options: { asking_now?: boolean } = {},
): TalkContext {
  const location = findLocationById(blueprint, locationId);

  return {
    active_location_id: locationId,
    active_location_name: location?.name ?? locationId,
    active_location_description: location?.description ?? null,
    locations: buildTalkLocationSummaries(blueprint),
    characters: buildTalkCharacterPublicSummaries(blueprint),
    active_character: buildTalkCharacterPrivateContext(
      blueprint,
      characterId,
      buildPlayerKnownClues(blueprint, conversationHistory),
      conversationHistory,
      options,
    ),
  };
}

export function selectCharacterConversationHistory(
  conversationHistory: ConversationFragment[],
  characterId: string,
): ConversationFragment[] {
  return sanitizeConversationHistory(
    filterCharacterHistory(conversationHistory, characterId),
  );
}

export function selectLocationConversationHistory(
  conversationHistory: ConversationFragment[],
  locationId: string,
): ConversationFragment[] {
  return sanitizeConversationHistory(
    filterLocationHistory(conversationHistory, locationId),
  );
}

function selectConversationHistoryForRole(
  input: BuildContextInput,
): ConversationFragment[] {
  const conversationHistory = input.conversation_history ?? [];
  if (conversationHistory.length === 0) {
    return [];
  }

  if (
    input.role_name === "talk_start" ||
    input.role_name === "talk_conversation" ||
    input.role_name === "talk_end" ||
    input.role_name === "graph_talk"
  ) {
    const characterId =
      input.character_id ?? input.session.current_talk_character_id;
    if (!characterId) {
      return [];
    }

    return selectCharacterConversationHistory(conversationHistory, characterId);
  }

  if (input.role_name === "search" || input.role_name === "ambience") {
    const locationId =
      input.location_id ?? input.session.current_location_id;
    if (!locationId) {
      return [];
    }

    return selectLocationConversationHistory(conversationHistory, locationId);
  }

  if (
    input.role_name === "accusation_start" ||
    input.role_name === "accusation_judge"
  ) {
    if (input.accusation_history_mode === "none") {
      return [];
    }

    return sanitizeConversationHistory(conversationHistory);
  }

  return sanitizeConversationHistory(conversationHistory);
}

function buildContext(input: BuildContextInput): AIContext {
  const resolvedLocationId =
    input.location_id ?? input.session.current_location_id ?? null;
  const resolvedCharacterId =
    input.character_id ?? input.session.current_talk_character_id;

  const context: AIContext = {
    game_id: input.game_id,
    role_name: input.role_name,
    mode: input.session.mode,
    forced_by_timeout: input.forced_by_timeout ?? false,
    location_id: resolvedLocationId,
    character_id: resolvedCharacterId,
    player_input: input.player_input ?? null,
    conversation_history: selectConversationHistoryForRole(input),
    shared_mystery_context: buildSharedMysteryContext(input.blueprint),
    move_context: input.move_context ?? null,
    search_context: input.search_context ?? null,
    talk_context: input.talk_context ?? null,
    accusation_start_context: input.accusation_start_context ?? null,
    accusation_judge_context: input.accusation_judge_context ?? null,
    ...(input.graph_talk_context ? { graph_talk_context: input.graph_talk_context } : {}),
    ...(input.graph_search_context ? { graph_search_context: input.graph_search_context } : {}),
  };

  assertRoleContextSafety(input.role_name, context);
  return context;
}

export function buildTalkStartContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  character_id: string;
  location_id: string;
  conversation_history?: ConversationFragment[];
}): AIContext {
  return buildContext({
    game_id: input.game_id,
    role_name: "talk_start",
    session: input.session,
    blueprint: input.blueprint,
    location_id: input.location_id,
    character_id: input.character_id,
    conversation_history: input.conversation_history,
    talk_context: buildTalkContext(
      input.blueprint,
      input.location_id,
      input.character_id,
      input.conversation_history ?? [],
    ),
  });
}

export function buildTalkConversationContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  character_id: string;
  player_input: string;
  location_id: string;
  conversation_history?: ConversationFragment[];
}): AIContext {
  return buildContext({
    game_id: input.game_id,
    role_name: "talk_conversation",
    session: input.session,
    blueprint: input.blueprint,
    location_id: input.location_id,
    character_id: input.character_id,
    player_input: input.player_input,
    conversation_history: input.conversation_history,
    talk_context: buildTalkContext(
      input.blueprint,
      input.location_id,
      input.character_id,
      input.conversation_history ?? [],
      { asking_now: true },
    ),
  });
}

/**
 * A clue-graph case's world view lists every clue a character holds; outside
 * its own talk context (`clue-graph/`), a narrator sees only those already
 * found. The rest stay with the graph.
 */
function foundCluesOnly(blueprint: BlueprintContext, history: ConversationFragment[]): BlueprintContext {
  if (!blueprint.clue_graph) return blueprint;
  const found = buildDiscoveredClueIdSet(history);
  return {
    ...blueprint,
    world: {
      ...blueprint.world,
      characters: blueprint.world.characters.map((character) => ({
        ...character,
        clues: character.clues.filter((clue) => found.has(clue.id)),
      })),
    },
  };
}

export function buildTalkEndContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  character_id: string;
  location_id: string;
  conversation_history?: ConversationFragment[];
}): AIContext {
  return buildContext({
    game_id: input.game_id,
    role_name: "talk_end",
    session: input.session,
    blueprint: input.blueprint,
    location_id: input.location_id,
    character_id: input.character_id,
    conversation_history: input.conversation_history,
    talk_context: buildTalkContext(
      foundCluesOnly(input.blueprint, input.conversation_history ?? []),
      input.location_id,
      input.character_id,
      input.conversation_history ?? [],
    ),
  });
}

function toSearchClue(clue: BlueprintClue): SearchClue {
  const shown: BlueprintClue = { ...clue };
  delete shown.requires;
  return shown;
}

export function buildSearchContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  location_id: string;
  revealed_clue_ids: string[];
  // Session-global set of discovered clue ids, used to gate locked clues. A clue
  // whose `requires` prerequisites are not all discovered is filtered out of the
  // prompt context so the narrator never weaves a locked clue's text in.
  discovered_clue_ids?: string[];
  next_clue: BlueprintClue | null;
  search_query?: string | null;
  conversation_history?: ConversationFragment[];
}): AIContext {
  const location = findLocationById(input.blueprint, input.location_id);
  if (!location) {
    throw new Error(`Location ${input.location_id} not found in blueprint`);
  }

  const revealedSet = new Set(input.revealed_clue_ids);
  const discoveredSet = new Set(
    input.discovered_clue_ids ?? input.revealed_clue_ids,
  );
  // A clue is visible to the narrator only if it has already been revealed or is
  // currently unlocked. Locked clues are stripped from EVERY clue list in the
  // context (not just `unrevealed_clues`) so their text can never be woven into
  // narration before the player has earned them.
  const isVisible = (c: BlueprintClue) =>
    revealedSet.has(c.id) || isClueUnlocked(c, discoveredSet);
  // A spot whose clues are all locked is left out altogether, so the narrator
  // never advertises it or narrates "nothing here" for it, unless this targeted
  // search names it: then it is shown, clues and all, to narrate the find.
  const admitted = input.blueprint.msf ? null : namedHiddenSpot(location, input.search_query, discoveredSet)?.id ?? null;
  const subLocations: SubLocationContext[] = (location.sub_locations ?? [])
    .filter((sl) => sl.id === admitted || !isSpotHidden(sl, discoveredSet))
    .map((sl) => {
      // A named hidden spot shows only the clue the search can admit.
      const visibleClues = (sl.id === admitted ? sl.clues.slice(0, 1) : sl.clues.filter(isVisible)).map(toSearchClue);
      const unrevealed = visibleClues.filter((c) => !revealedSet.has(c.id));
      return {
        id: sl.id,
        name: sl.name,
        hint: sl.hint,
        clues: visibleClues,
        unrevealed_clues: unrevealed,
        has_unrevealed_clues: unrevealed.length > 0,
      };
    });

  return buildContext({
    game_id: input.game_id,
    role_name: "search",
    session: input.session,
    blueprint: input.blueprint,
    location_id: input.location_id,
    conversation_history: input.conversation_history,
    search_context: {
      location_id: location.id,
      location_name: location.name,
      location_description: location.description,
      clues: location.clues.filter(isVisible).map(toSearchClue),
      revealed_clue_ids: input.revealed_clue_ids,
      next_clue: input.next_clue && toSearchClue(input.next_clue),
      sub_locations: subLocations,
      search_query: input.search_query ?? null,
    },
  });
}

export function buildMoveContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  destination_id: string;
  has_visited_before: boolean;
  conversation_history?: ConversationFragment[];
}): AIContext {
  const location = findLocationById(input.blueprint, input.destination_id);
  if (!location) {
    throw new Error(`Location ${input.destination_id} not found in blueprint`);
  }

  const destinationCharacters = buildArrivalCharacterContexts(
    input.blueprint,
    location.id,
    input.conversation_history ?? [],
  );

  return buildContext({
    game_id: input.game_id,
    role_name: "ambience",
    session: input.session,
    blueprint: input.blueprint,
    location_id: input.destination_id,
    conversation_history: input.conversation_history,
    move_context: {
      destination_id: location.id,
      destination_name: location.name,
      destination_description: location.description,
      has_visited_before: input.has_visited_before,
      last_arrival_narration: selectLastArrivalNarration(
        input.conversation_history ?? [],
        input.destination_id,
      ),
      destination_characters: destinationCharacters,
    },
  });
}

export function buildAccusationStartContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  forced_by_timeout?: boolean;
  player_input?: string | null;
  conversation_history?: ConversationFragment[];
  history_mode?: "all" | "none";
}): AIContext {
  const location = findLocationById(
    input.blueprint,
    input.session.current_location_id,
  );

  return buildContext({
    game_id: input.game_id,
    role_name: "accusation_start",
    session: input.session,
    forced_by_timeout: input.forced_by_timeout ?? false,
    blueprint: input.blueprint,
    player_input: input.player_input ?? null,
    conversation_history: input.conversation_history,
    accusation_history_mode: input.history_mode ?? "all",
    accusation_start_context: {
      current_location_id: input.session.current_location_id ?? null,
      current_location_name: location?.name ?? null,
      current_location_description: location?.description ?? null,
      characters: buildTalkCharacterPublicSummaries(input.blueprint),
    },
  });
}

export function buildAccusationJudgeContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  player_input: string;
  round: number;
  conversation_history?: ConversationFragment[];
  history_mode?: "all" | "none";
}): AIContext {
  // Reconstructed from the full session history (searches included), not the
  // `discovered_clues` cache — same source of truth as the talk context.
  const discovered = buildDiscoveredClueIdSet(input.conversation_history ?? []);
  return buildContext({
    game_id: input.game_id,
    role_name: "accusation_judge",
    session: input.session,
    blueprint: input.blueprint,
    player_input: input.player_input,
    conversation_history: input.conversation_history,
    accusation_history_mode: input.history_mode ?? "all",
    accusation_judge_context: {
      round: input.round,
      full_blueprint: input.blueprint,
      player_known_clues: buildKnownCluesWithOrigin(input.blueprint, discovered),
      path_coverage: buildPathCoverage(input.blueprint, discovered),
      ...(input.blueprint.msf ? { msf_progress: evaluateMysteryStructure(input.blueprint.msf.structure, discovered) } : {}),
      ...(input.blueprint.clue_graph
        ? { clue_graph_progress: clueGraphProgress(input.blueprint.clue_graph, input.conversation_history ?? []) }
        : {}),
    },
  });
}

function clueGraphProgress(graph: ClueGraphCase, history: ConversationFragment[]): ClueGraphProgress {
  const play = playOf(graph, history);
  const supported = supportedConclusions(graph, play);
  const culprit = Object.keys(graph.characters).find((id) => graph.characters[id].role === "culprit");
  return {
    supported_conclusions: supported.map((id) => ({ id, text: graph.conclusions[id].text })),
    culprit_supported: supported.some((id) => graph.conclusions[id].culprit === culprit),
    taken_back: play.retracted.filter((id) => play.held.includes(id)).map((id) => graph.clues[id].text),
  };
}

function graphOf(blueprint: BlueprintContext): ClueGraphCase {
  if (!blueprint.clue_graph) throw new Error("Not a clue-graph case");
  return blueprint.clue_graph;
}

/** A clue-graph talk line, or its greeting when `player_input` is null. */
export function buildGraphTalkAIContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  character_id: string;
  location_id: string;
  player_input: string | null;
  conversation_history?: ConversationFragment[];
}): AIContext {
  const graph = graphOf(input.blueprint);
  const history = input.conversation_history ?? [];
  return buildContext({
    game_id: input.game_id,
    role_name: "graph_talk",
    session: input.session,
    blueprint: input.blueprint,
    location_id: input.location_id,
    character_id: input.character_id,
    player_input: input.player_input,
    conversation_history: history,
    graph_talk_context: buildGraphTalkContext(graph, playOf(graph, history), input.character_id, input.player_input === null),
  });
}

/** A clue-graph search, plain when `search_query` is null. */
export function buildGraphSearchAIContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  location_id: string;
  search_query: string | null;
  conversation_history?: ConversationFragment[];
}): AIContext {
  const graph = graphOf(input.blueprint);
  const history = input.conversation_history ?? [];
  return buildContext({
    game_id: input.game_id,
    role_name: "search",
    session: input.session,
    blueprint: input.blueprint,
    location_id: input.location_id,
    conversation_history: history,
    graph_search_context: buildGraphSearchContext(graph, playOf(graph, history), input.search_query),
  });
}

export function assertRoleContextSafety(
  role: ContextRoleName,
  context: AIContext,
): void {
  if (role === "accusation_judge") {
    if (!context.accusation_judge_context) {
      throw new Error(
        "Invalid context: accusation_judge requires accusation_judge_context",
      );
    }
    return;
  }

  if (context.accusation_judge_context) {
    throw new Error(
      `Invalid context: ${role} is not allowed to include accusation_judge_context`,
    );
  }
}
