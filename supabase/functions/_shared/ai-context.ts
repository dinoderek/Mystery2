import type { AIRoleName } from "./ai-contracts.ts";

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
    starting_knowledge?: string[];
  };
  world: {
    locations: Array<{
      name: string;
      description: string;
      clues: string[];
      location_image_id?: string;
    }>;
    characters: Array<{
      first_name: string;
      last_name: string;
      location: string;
      sex: "male" | "female";
      appearance?: string;
      background?: string;
      personality?: string;
      initial_attitude_towards_investigator?: string;
      mystery_action_real?: string;
      stated_alibi?: string | null;
      motive?: string | null;
      is_culprit?: boolean;
      portrait_image_id?: string;
      knowledge?: string[];
    }>;
  };
  ground_truth: Record<string, unknown>;
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
  destination_name: string;
  destination_description: string;
  has_visited_before: boolean;
  destination_history: ConversationFragment[];
  destination_characters: TalkCharacterPublicSummary[];
}

export interface SearchContext {
  location_name: string;
  location_description: string;
  clues: string[];
  revealed_clues: string[];
  next_clue: string | null;
  has_more_clues: boolean;
}

export interface TalkLocationSummary {
  name: string;
  description: string;
}

export interface TalkCharacterPublicSummary {
  first_name: string;
  last_name: string;
  location: string;
  sex: "male" | "female";
  appearance: string | null;
  background: string | null;
}

export interface TalkCharacterPrivateContext extends TalkCharacterPublicSummary {
  personality: string | null;
  initial_attitude_towards_investigator: string | null;
  stated_alibi: string | null;
  motive: string | null;
  knowledge: string[];
  mystery_action_real: string | null;
}

export interface TalkContext {
  active_location_name: string;
  active_location_description: string | null;
  locations: TalkLocationSummary[];
  characters: TalkCharacterPublicSummary[];
  active_character: TalkCharacterPrivateContext;
}

export interface AccusationStartContext {
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
  location_name: string | null;
  character_name: string | null;
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
  location_name?: string | null;
  character_name?: string | null;
  player_input?: string | null;
  conversation_history?: ConversationFragment[];
  accusation_history_mode?: "all" | "none";
  move_context?: MoveContext | null;
  search_context?: SearchContext | null;
  talk_context?: TalkContext | null;
  accusation_start_context?: AccusationStartContext | null;
  accusation_judge_context?: AccusationJudgeContext | null;
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
    "character_name",
    "character",
    "location_name",
    "destination",
    "player_input",
    "revealed_clue_text",
    "follow_up_prompt",
  ];

  for (const field of stringFields) {
    const value = readPayloadField(payload, field);
    if (value !== null) {
      sanitized[field] = value;
    }
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
  characterName: string,
): ConversationFragment[] {
  return conversationHistory.filter((entry) => {
    if (
      entry.event_type !== "talk" &&
      entry.event_type !== "ask" &&
      entry.event_type !== "end_talk"
    ) {
      return false;
    }

    const payloadCharacter =
      readPayloadField(entry.payload, "character_name") ??
      readPayloadField(entry.payload, "character");
    return payloadCharacter === characterName || entry.actor === characterName;
  });
}

function filterLocationHistory(
  conversationHistory: ConversationFragment[],
  locationName: string,
): ConversationFragment[] {
  return conversationHistory.filter((entry) => {
    const payloadLocation =
      readPayloadField(entry.payload, "location_name") ??
      readPayloadField(entry.payload, "destination");
    return payloadLocation === locationName;
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
    name: location.name,
    description: location.description,
  }));
}

function buildTalkCharacterPublicSummaries(
  blueprint: BlueprintContext,
): TalkCharacterPublicSummary[] {
  return blueprint.world.characters.map((character) => ({
    first_name: character.first_name,
    last_name: character.last_name,
    location: character.location,
    sex: character.sex,
    appearance: character.appearance ?? null,
    background: character.background ?? null,
  }));
}

function buildTalkCharacterPrivateContext(
  blueprint: BlueprintContext,
  characterName: string,
): TalkCharacterPrivateContext {
  const character = blueprint.world.characters.find(
    (entry) => entry.first_name === characterName,
  );
  if (!character) {
    throw new Error(`Character ${characterName} not found in blueprint`);
  }

  return {
    first_name: character.first_name,
    last_name: character.last_name,
    location: character.location,
    sex: character.sex,
    appearance: character.appearance ?? null,
    background: character.background ?? null,
    personality: character.personality ?? null,
    initial_attitude_towards_investigator:
      character.initial_attitude_towards_investigator ?? null,
    stated_alibi: character.stated_alibi ?? null,
    motive: character.motive ?? null,
    knowledge: character.knowledge ?? [],
    mystery_action_real: character.mystery_action_real ?? null,
  };
}

function buildTalkContext(
  blueprint: BlueprintContext,
  locationName: string,
  characterName: string,
): TalkContext {
  const location = blueprint.world.locations.find(
    (entry) => entry.name === locationName,
  );

  return {
    active_location_name: locationName,
    active_location_description: location?.description ?? null,
    locations: buildTalkLocationSummaries(blueprint),
    characters: buildTalkCharacterPublicSummaries(blueprint),
    active_character: buildTalkCharacterPrivateContext(blueprint, characterName),
  };
}

export function selectCharacterConversationHistory(
  conversationHistory: ConversationFragment[],
  characterName: string,
): ConversationFragment[] {
  return sanitizeConversationHistory(
    filterCharacterHistory(conversationHistory, characterName),
  );
}

export function selectLocationConversationHistory(
  conversationHistory: ConversationFragment[],
  locationName: string,
): ConversationFragment[] {
  return sanitizeConversationHistory(
    filterLocationHistory(conversationHistory, locationName),
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
    const characterName =
      input.character_name ?? input.session.current_talk_character_id;
    if (!characterName) {
      return [];
    }

    return selectCharacterConversationHistory(conversationHistory, characterName);
  }

  if (input.role_name === "search") {
    const locationName =
      input.location_name ?? input.session.current_location_id;
    if (!locationName) {
      return [];
    }

    return selectLocationConversationHistory(conversationHistory, locationName);
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
  const resolvedLocationName =
    input.location_name ?? input.session.current_location_id ?? null;
  const resolvedCharacterName =
    input.character_name ?? input.session.current_talk_character_id;

  const context: AIContext = {
    game_id: input.game_id,
    role_name: input.role_name,
    mode: input.session.mode,
    forced_by_timeout: input.forced_by_timeout ?? false,
    location_name: resolvedLocationName,
    character_name: resolvedCharacterName,
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
  character_name: string;
  location_name: string;
  conversation_history?: ConversationFragment[];
}): AIContext {
  return buildContext({
    game_id: input.game_id,
    role_name: "talk_start",
    session: input.session,
    blueprint: input.blueprint,
    location_name: input.location_name,
    character_name: input.character_name,
    conversation_history: input.conversation_history,
    talk_context: buildTalkContext(
      input.blueprint,
      input.location_name,
      input.character_name,
    ),
  });
}

export function buildTalkConversationContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  character_name: string;
  player_input: string;
  location_name: string;
  conversation_history?: ConversationFragment[];
}): AIContext {
  return buildContext({
    game_id: input.game_id,
    role_name: "talk_conversation",
    session: input.session,
    blueprint: input.blueprint,
    location_name: input.location_name,
    character_name: input.character_name,
    player_input: input.player_input,
    conversation_history: input.conversation_history,
    talk_context: buildTalkContext(
      input.blueprint,
      input.location_name,
      input.character_name,
    ),
  });
}

export function buildTalkEndContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  character_name: string;
  location_name: string;
  conversation_history?: ConversationFragment[];
}): AIContext {
  return buildContext({
    game_id: input.game_id,
    role_name: "talk_end",
    session: input.session,
    blueprint: input.blueprint,
    location_name: input.location_name,
    character_name: input.character_name,
    conversation_history: input.conversation_history,
    talk_context: buildTalkContext(
      input.blueprint,
      input.location_name,
      input.character_name,
    ),
  });
}

export function buildSearchContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  location_name: string;
  revealed_clues: string[];
  next_clue: string | null;
  conversation_history?: ConversationFragment[];
}): AIContext {
  const location = input.blueprint.world.locations.find(
    (entry) => entry.name === input.location_name,
  );
  if (!location) {
    throw new Error(`Location ${input.location_name} not found in blueprint`);
  }

  return buildContext({
    game_id: input.game_id,
    role_name: "search",
    session: input.session,
    blueprint: input.blueprint,
    location_name: input.location_name,
    conversation_history: input.conversation_history,
    search_context: {
      location_name: location.name,
      location_description: location.description,
      clues: location.clues,
      revealed_clues: input.revealed_clues,
      next_clue: input.next_clue,
      has_more_clues: input.next_clue !== null,
    },
  });
}

export function buildMoveContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  destination_name: string;
  has_visited_before: boolean;
  conversation_history?: ConversationFragment[];
}): AIContext {
  const location = input.blueprint.world.locations.find(
    (entry) => entry.name === input.destination_name,
  );
  if (!location) {
    throw new Error(`Location ${input.destination_name} not found in blueprint`);
  }

  const destinationHistory = selectLocationConversationHistory(
    input.conversation_history ?? [],
    input.destination_name,
  );
  const destinationCharacters = buildTalkCharacterPublicSummaries(
    input.blueprint,
  ).filter((character) => character.location === input.destination_name);

  return buildContext({
    game_id: input.game_id,
    role_name: "search",
    session: input.session,
    blueprint: input.blueprint,
    location_name: input.destination_name,
    conversation_history: input.conversation_history,
    move_context: {
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
  const location = input.blueprint.world.locations.find(
    (entry) => entry.name === input.session.current_location_id,
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
      current_location_name: input.session.current_location_id ?? null,
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
