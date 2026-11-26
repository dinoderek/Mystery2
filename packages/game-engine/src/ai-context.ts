import type { AIRoleName } from "./ai-contracts.ts";
import { buildDiscoveredClueIdSet } from "./clue-discovery.ts";
import { type ClueRef, mapClueIdsToClues } from "./clues.ts";
import type { ClueGraphCase } from "../../shared/src/clue-graph-schema.ts";
import type { ClueGraphWorld } from "../../shared/src/clue-graph-case.ts";
import { ACCUSE_FAILED } from "./accusations.ts";
import { playOf } from "./clue-graph/history.ts";
import { lineOf, supportedConclusions } from "./clue-graph/play.ts";
import {
  accusationContext,
  verdictContext,
  type AccusationVerdict,
  type GraphAccusationContext,
  type GraphVerdictContext,
} from "./clue-graph/accusation.ts";
import {
  buildGraphSearchContext,
  buildGraphTalkContext,
  type GraphSearchContext,
  type GraphTalkContext,
} from "./clue-graph/narrator-context.ts";

/** The world view a narrator context is built from. The reader's age is every request's own `reading_age`. */
export type BlueprintContext = ClueGraphWorld;

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
  /** The age the narration is written for: the reader's. */
  reading_age: number;
}

// The role a context is built for: an output-contract role; `ambience`,
// arrival narration, which has no output contract but does have a context; or
// `search`, the name a search's context goes by, as its events do.
export type ContextRoleName = AIRoleName | "ambience" | "search";

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
  sex: "male" | "female";
  appearance: string;
  personality: string;
  initial_attitude_towards_investigator: string;
}

export interface TalkLocationSummary {
  id: string;
  name: string;
  description: string;
}

// What any character context may say about a character other than the active
// one: identity and visible appearance. What a character knows reaches another
// only through the clue graph.
export interface TalkCharacterPublicSummary {
  id: string;
  first_name: string;
  location_id: string;
  sex: "male" | "female";
  appearance: string;
}

// The active character of a goodbye: how they carry themselves, and the clues
// of theirs the player has found, as their notebook lines.
export interface TalkCharacterPrivateContext extends TalkCharacterPublicSummary {
  personality: string;
  initial_attitude_towards_investigator: string;
  clues: ClueRef[];
  player_known_clues: ClueRef[];
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

/** What an investigation has earned, derived from the events. */
export interface ClueGraphProgress {
  /** Conclusions whose rule holds over the clues held and not taken back. */
  supported_conclusions: Array<{ id: string; text: string }>;
  /** Whether a supported conclusion names the culprit. Alone it never wins. */
  culprit_supported: boolean;
  /** Statements the investigator has had taken back. */
  taken_back: string[];
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
  talk_context: TalkContext | null;
  accusation_start_context: AccusationStartContext | null;
  // Present only for talk and search (`clue-graph/`).
  graph_talk_context?: GraphTalkContext;
  graph_search_context?: GraphSearchContext;
  // Present only for an accusation (`clue-graph/accusation.ts`).
  graph_accusation_context?: GraphAccusationContext | GraphVerdictContext;
};

interface BuildContextInput {
  game_id: string;
  role_name: ContextRoleName;
  session: SessionSnapshot;
  forced_by_timeout?: boolean;
  blueprint: BlueprintContext;
  reading_age: number;
  location_id?: string | null;
  character_id?: string | null;
  player_input?: string | null;
  conversation_history?: ConversationFragment[];
  accusation_history_mode?: "all" | "none";
  move_context?: MoveContext | null;
  talk_context?: TalkContext | null;
  accusation_start_context?: AccusationStartContext | null;
  graph_talk_context?: GraphTalkContext;
  graph_search_context?: GraphSearchContext;
  graph_accusation_context?: GraphAccusationContext | GraphVerdictContext;
}

type Location = BlueprintContext["world"]["locations"][number];
type Character = BlueprintContext["world"]["characters"][number];

export function findLocationById(blueprint: BlueprintContext, locationId: string): Location | undefined {
  return blueprint.world.locations.find((l) => l.id === locationId);
}

export function findCharacterById(blueprint: BlueprintContext, characterId: string): Character | undefined {
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

function buildSharedMysteryContext(readingAge: number): SharedMysteryContext {
  return { reading_age: readingAge };
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
  return blueprint.world.characters.map((character) => ({
    id: character.id,
    first_name: character.first_name,
    location_id: character.location_id,
    sex: character.sex,
    appearance: character.appearance,
  }));
}

export function buildPlayerKnownClues(
  blueprint: BlueprintContext,
  conversationHistory: ConversationFragment[],
): ClueRef[] {
  const clueIds = buildDiscoveredClueIdSet(conversationHistory);

  if (clueIds.size === 0) return [];

  return mapClueIdsToClues(blueprint, clueIds);
}

function buildTalkCharacterPrivateContext(
  blueprint: BlueprintContext,
  characterId: string,
  playerKnownClues: ClueRef[],
): TalkCharacterPrivateContext {
  const character = findCharacterById(blueprint, characterId);
  if (!character) {
    throw new Error(`Character ${characterId} not found in blueprint`);
  }

  return {
    id: character.id,
    first_name: character.first_name,
    location_id: character.location_id,
    sex: character.sex,
    appearance: character.appearance,
    personality: character.personality,
    initial_attitude_towards_investigator: character.initial_attitude_towards_investigator,
    clues: character.clues.map((clue) => ({ id: clue.id, text: clue.text })),
    player_known_clues: playerKnownClues,
  };
}

/**
 * Every character standing at a location, as arrival narration needs them:
 * looks, personality and attitude. Nobody has asked anything yet, so nothing
 * they know, did or claim is passed.
 */
export function buildArrivalCharacterContexts(
  blueprint: BlueprintContext,
  locationId: string,
): ArrivalCharacterContext[] {
  return blueprint.world.characters
    .filter((character) => character.location_id === locationId)
    .map((character) => ({
      id: character.id,
      first_name: character.first_name,
      sex: character.sex,
      appearance: character.appearance,
      personality: character.personality,
      initial_attitude_towards_investigator: character.initial_attitude_towards_investigator,
    }));
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

const ACCUSATION_HISTORY = new Set(["accuse_start", "forced_endgame", ACCUSE_FAILED]);

function selectConversationHistoryForRole(
  input: BuildContextInput,
): ConversationFragment[] {
  const conversationHistory = input.conversation_history ?? [];
  if (conversationHistory.length === 0) {
    return [];
  }

  if (input.role_name === "talk_end" || input.role_name === "graph_talk") {
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

  // An accusation reads only the accusation so far: what it may tell is in its
  // own context (`clue-graph/accusation.ts`).
  if (
    input.role_name === "graph_accusation" ||
    input.role_name === "graph_accusation_round" ||
    input.role_name === "graph_ending"
  ) {
    return sanitizeConversationHistory(conversationHistory.filter((entry) => ACCUSATION_HISTORY.has(entry.event_type)));
  }

  if (input.role_name === "accusation_start" && input.accusation_history_mode === "none") {
    return [];
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
    shared_mystery_context: buildSharedMysteryContext(input.reading_age),
    move_context: input.move_context ?? null,
    talk_context: input.talk_context ?? null,
    accusation_start_context: input.accusation_start_context ?? null,
    ...(input.graph_talk_context ? { graph_talk_context: input.graph_talk_context } : {}),
    ...(input.graph_search_context ? { graph_search_context: input.graph_search_context } : {}),
    ...(input.graph_accusation_context ? { graph_accusation_context: input.graph_accusation_context } : {}),
  };

  assertRoleContextSafety(input.role_name, context);
  return context;
}

/**
 * The case's world view with every clue the player holds reading as its saved
 * notebook line, as the notebook shows it, so later narration never words it
 * afresh.
 */
function withSavedLines(blueprint: BlueprintContext, history: ConversationFragment[]): BlueprintContext {
  const graph = blueprint.clue_graph;
  const play = playOf(graph, history);
  const reword = <C extends { id: string; text: string }>(clues: C[]): C[] =>
    clues.map((clue) => (play.held.includes(clue.id) ? { ...clue, text: lineOf(graph, play, clue.id) } : clue));
  return {
    ...blueprint,
    world: {
      ...blueprint.world,
      locations: blueprint.world.locations.map((location) => ({
        ...location,
        clues: reword(location.clues),
        sub_locations: location.sub_locations.map((spot) => ({ ...spot, clues: reword(spot.clues) })),
      })),
      characters: blueprint.world.characters.map((character) => ({ ...character, clues: reword(character.clues) })),
    },
  };
}

/**
 * The world view lists every clue a character holds; outside its own talk
 * context (`clue-graph/`), a narrator sees only those already found, as their
 * notebook lines. The rest stay with the graph.
 */
function foundCluesOnly(blueprint: BlueprintContext, history: ConversationFragment[]): BlueprintContext {
  const worded = withSavedLines(blueprint, history);
  const found = buildDiscoveredClueIdSet(history);
  return {
    ...worded,
    world: {
      ...worded.world,
      characters: worded.world.characters.map((character) => ({
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
  reading_age: number;
  character_id: string;
  location_id: string;
  conversation_history?: ConversationFragment[];
}): AIContext {
  return buildContext({
    game_id: input.game_id,
    role_name: "talk_end",
    session: input.session,
    blueprint: input.blueprint,
    reading_age: input.reading_age,
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

export function buildMoveContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  reading_age: number;
  destination_id: string;
  has_visited_before: boolean;
  conversation_history?: ConversationFragment[];
}): AIContext {
  const location = findLocationById(input.blueprint, input.destination_id);
  if (!location) {
    throw new Error(`Location ${input.destination_id} not found in blueprint`);
  }

  return buildContext({
    game_id: input.game_id,
    role_name: "ambience",
    session: input.session,
    blueprint: input.blueprint,
    reading_age: input.reading_age,
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
      destination_characters: buildArrivalCharacterContexts(input.blueprint, location.id),
    },
  });
}

export function buildAccusationStartContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  reading_age: number;
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
    reading_age: input.reading_age,
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

/** What the investigation has earned so far, from the events. */
export function clueGraphProgress(graph: ClueGraphCase, history: ConversationFragment[]): ClueGraphProgress {
  const play = playOf(graph, history);
  const supported = supportedConclusions(graph, play);
  const culprit = Object.keys(graph.characters).find((id) => graph.characters[id].role === "culprit");
  return {
    supported_conclusions: supported.map((id) => ({ id, text: graph.conclusions[id].text })),
    culprit_supported: supported.some((id) => graph.conclusions[id].culprit === culprit),
    taken_back: play.retracted.filter((id) => play.held.includes(id)).map((id) => lineOf(graph, play, id)),
  };
}

/** An accusation as the narrator reads it: who was named, and what was cited. */
export function buildGraphAccusationAIContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  reading_age: number;
  player_input: string;
  conversation_history?: ConversationFragment[];
}): AIContext {
  const graph = graphOf(input.blueprint);
  const history = input.conversation_history ?? [];
  return buildContext({
    game_id: input.game_id,
    role_name: "graph_accusation",
    session: input.session,
    blueprint: input.blueprint,
    reading_age: input.reading_age,
    player_input: input.player_input,
    conversation_history: history,
    graph_accusation_context: accusationContext(graph, playOf(graph, history)),
  });
}

/**
 * The narration of what the engine decided: a failed accusation before the case is
 * resolved, given only what the investigator holds, or the closing scene,
 * given the whole truth.
 */
export function buildGraphVerdictAIContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  reading_age: number;
  player_input: string;
  verdict: AccusationVerdict;
  /** The held clues the judge found cited in this accusation. */
  cited?: string[];
  accused?: string | null;
  conversation_history?: ConversationFragment[];
}): AIContext {
  const graph = graphOf(input.blueprint);
  const history = input.conversation_history ?? [];
  const resolved = input.verdict === "win" || input.verdict === "lose";
  const turnsSpent = !resolved && input.session.time_remaining === 0;
  return buildContext({
    game_id: input.game_id,
    role_name: resolved ? "graph_ending" : "graph_accusation_round",
    session: input.session,
    blueprint: input.blueprint,
    reading_age: input.reading_age,
    player_input: input.player_input,
    conversation_history: history,
    forced_by_timeout: turnsSpent,
    graph_accusation_context: verdictContext(graph, playOf(graph, history), input.verdict, { cited: input.cited ?? [], accused: input.accused ?? null }, turnsSpent),
  });
}

function graphOf(blueprint: BlueprintContext): ClueGraphCase {
  return blueprint.clue_graph;
}

/** A talk line, or its greeting when `player_input` is null. */
export function buildGraphTalkAIContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  reading_age: number;
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
    reading_age: input.reading_age,
    location_id: input.location_id,
    character_id: input.character_id,
    player_input: input.player_input,
    conversation_history: history,
    graph_talk_context: buildGraphTalkContext(graph, playOf(graph, history), input.character_id, input.player_input === null),
  });
}

/** A search, plain when `search_query` is null. */
export function buildGraphSearchAIContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  reading_age: number;
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
    reading_age: input.reading_age,
    location_id: input.location_id,
    conversation_history: history,
    graph_search_context: buildGraphSearchContext(graph, playOf(graph, history), input.search_query),
  });
}

export function assertRoleContextSafety(
  role: ContextRoleName,
  context: AIContext,
): void {
  // Only the closing scene is told the truth.
  if (role !== "graph_ending" && context.graph_accusation_context && "ending" in context.graph_accusation_context) {
    throw new Error(`Invalid context: ${role} is not allowed to include the ending`);
  }
}
