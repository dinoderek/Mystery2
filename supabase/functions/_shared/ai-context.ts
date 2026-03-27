import type { AIRoleName } from "./ai-contracts.ts";

export interface BlueprintClue {
  id: string;
  text: string;
  role: string;
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
  metadata: {
    title: string;
    one_liner: string;
    target_age: number;
    time_budget?: number;
    image_id?: string;
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

export interface MoveContext {
  destination_id: string;
  destination_name: string;
  destination_description: string;
  has_visited_before: boolean;
  destination_history: ConversationFragment[];
  destination_characters: TalkCharacterPublicSummary[];
}

export interface SearchContext {
  location_id: string;
  location_name: string;
  location_description: string;
  clues: BlueprintClue[];
  revealed_clue_ids: string[];
  next_clue: BlueprintClue | null;
  has_more_clues: boolean;
}

export interface TalkLocationSummary {
  id: string;
  name: string;
  description: string;
}

export interface TalkCharacterPublicSummary {
  id: string;
  first_name: string;
  last_name: string;
  location_id: string;
  sex: "male" | "female";
  appearance: string;
  background: string;
}

export interface TalkCharacterPrivateContext extends TalkCharacterPublicSummary {
  personality: string;
  initial_attitude_towards_investigator: string;
  stated_alibi: string | null;
  motive: string | null;
  clues: BlueprintClue[];
  flavor_knowledge: string[];
  actual_actions: BlueprintActualAction[];
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
}

export interface AccusationJudgeContext {
  round: number;
  full_blueprint: BlueprintContext;
}

export interface AIContext {
  game_id: string;
  role_name: AIRoleName;
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
}

interface BuildContextInput {
  game_id: string;
  role_name: AIRoleName;
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
    "follow_up_prompt",
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

function buildTalkCharacterPublicSummaries(
  blueprint: BlueprintContext,
): TalkCharacterPublicSummary[] {
  return blueprint.world.characters.map((character) => ({
    id: character.id,
    first_name: character.first_name,
    last_name: character.last_name,
    location_id: character.location_id,
    sex: character.sex,
    appearance: character.appearance,
    background: character.background,
  }));
}

function buildTalkCharacterPrivateContext(
  blueprint: BlueprintContext,
  characterId: string,
): TalkCharacterPrivateContext {
  const character = blueprint.world.characters.find(
    (entry) => entry.id === characterId,
  );
  if (!character) {
    throw new Error(`Character ${characterId} not found in blueprint`);
  }

  return {
    id: character.id,
    first_name: character.first_name,
    last_name: character.last_name,
    location_id: character.location_id,
    sex: character.sex,
    appearance: character.appearance,
    background: character.background,
    personality: character.personality,
    initial_attitude_towards_investigator:
      character.initial_attitude_towards_investigator,
    stated_alibi: character.stated_alibi,
    motive: character.motive,
    clues: character.clues,
    flavor_knowledge: character.flavor_knowledge,
    actual_actions: character.actual_actions,
  };
}

function buildTalkContext(
  blueprint: BlueprintContext,
  locationId: string,
  characterId: string,
): TalkContext {
  const location = findLocationById(blueprint, locationId);

  return {
    active_location_id: locationId,
    active_location_name: location?.name ?? locationId,
    active_location_description: location?.description ?? null,
    locations: buildTalkLocationSummaries(blueprint),
    characters: buildTalkCharacterPublicSummaries(blueprint),
    active_character: buildTalkCharacterPrivateContext(blueprint, characterId),
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
    input.role_name === "talk_end"
  ) {
    const characterId =
      input.character_id ?? input.session.current_talk_character_id;
    if (!characterId) {
      return [];
    }

    return selectCharacterConversationHistory(conversationHistory, characterId);
  }

  if (input.role_name === "search") {
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
    ),
  });
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
      input.blueprint,
      input.location_id,
      input.character_id,
    ),
  });
}

export function buildSearchContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  location_id: string;
  revealed_clue_ids: string[];
  next_clue: BlueprintClue | null;
  conversation_history?: ConversationFragment[];
}): AIContext {
  const location = findLocationById(input.blueprint, input.location_id);
  if (!location) {
    throw new Error(`Location ${input.location_id} not found in blueprint`);
  }

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
      clues: location.clues,
      revealed_clue_ids: input.revealed_clue_ids,
      next_clue: input.next_clue,
      has_more_clues: input.next_clue !== null,
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

  const destinationHistory = selectLocationConversationHistory(
    input.conversation_history ?? [],
    input.destination_id,
  );
  const destinationCharacters = buildTalkCharacterPublicSummaries(
    input.blueprint,
  ).filter((character) => character.location_id === location.id);

  return buildContext({
    game_id: input.game_id,
    role_name: "search",
    session: input.session,
    blueprint: input.blueprint,
    location_id: input.destination_id,
    conversation_history: input.conversation_history,
    move_context: {
      destination_id: location.id,
      destination_name: location.name,
      destination_description: location.description,
      has_visited_before: input.has_visited_before,
      destination_history: destinationHistory,
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
    },
  });
}

export function assertRoleContextSafety(
  role: AIRoleName,
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
