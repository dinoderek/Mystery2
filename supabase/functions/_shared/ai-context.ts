import type { AIRoleName } from "./ai-contracts.ts";

export interface BlueprintContext {
  metadata: {
    title: string;
    one_liner: string;
    target_age: number;
  };
  narrative: {
    premise: string;
  };
  world: {
    locations: Array<{
      name: string;
      description: string;
    }>;
    characters: Array<{
      first_name: string;
      last_name: string;
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

export interface AIContext {
  game_id: string;
  role_name: AIRoleName;
  mode: SessionSnapshot["mode"];
  location_name: string | null;
  character_name: string | null;
  accused_character: string | null;
  player_input: string | null;
  conversation_history: ConversationFragment[];
  shared_mystery_context: {
    title: string;
    one_liner: string;
    target_age: number;
    location_names: string[];
    character_names: string[];
    current_location_description: string | null;
    premise: string;
  };
  ground_truth_context: Record<string, unknown> | null;
}

interface BuildContextInput {
  game_id: string;
  role_name: AIRoleName;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  location_name?: string | null;
  character_name?: string | null;
  accused_character?: string | null;
  player_input?: string | null;
  conversation_history?: ConversationFragment[];
  include_ground_truth?: boolean;
  accusation_history_mode?: "all" | "none";
}

function buildSharedMysteryContext(
  session: SessionSnapshot,
  blueprint: BlueprintContext,
  location_name?: string | null,
): AIContext["shared_mystery_context"] {
  const locationName = location_name ?? session.current_location_id ?? null;
  const currentLocation = blueprint.world.locations.find(
    (location) => location.name === locationName,
  );

  return {
    title: blueprint.metadata.title,
    one_liner: blueprint.metadata.one_liner,
    target_age: blueprint.metadata.target_age,
    location_names: blueprint.world.locations.map((location) => location.name),
    character_names: blueprint.world.characters.map(
      (character) => `${character.first_name} ${character.last_name}`,
    ),
    current_location_description: currentLocation?.description ?? null,
    premise: blueprint.narrative.premise,
  };
}

function sanitizeConversationHistory(
  conversationHistory: ConversationFragment[],
): ConversationFragment[] {
  return conversationHistory.map((entry) => ({
    sequence: entry.sequence,
    event_type: entry.event_type,
    actor: entry.actor,
    narration: entry.narration,
  }));
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

function filterCharacterHistory(
  conversationHistory: ConversationFragment[],
  characterName: string,
): ConversationFragment[] {
  return conversationHistory.filter((entry) => {
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
  if (!conversationHistory || conversationHistory.length === 0) {
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

    return selectCharacterConversationHistory(
      conversationHistory,
      characterName,
    );
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
  const context: AIContext = {
    game_id: input.game_id,
    role_name: input.role_name,
    mode: input.session.mode,
    location_name:
      input.location_name ?? input.session.current_location_id ?? null,
    character_name:
      input.character_name ?? input.session.current_talk_character_id,
    accused_character: input.accused_character ?? null,
    player_input: input.player_input ?? null,
    conversation_history: selectConversationHistoryForRole(input),
    shared_mystery_context: buildSharedMysteryContext(
      input.session,
      input.blueprint,
      input.location_name,
    ),
    ground_truth_context: input.include_ground_truth
      ? input.blueprint.ground_truth
      : null,
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
  });
}

export function buildSearchContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  location_name: string;
  conversation_history?: ConversationFragment[];
}): AIContext {
  return buildContext({
    game_id: input.game_id,
    role_name: "search",
    session: input.session,
    blueprint: input.blueprint,
    location_name: input.location_name,
    conversation_history: input.conversation_history,
  });
}

export function buildAccusationStartContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  accused_character: string;
  player_input?: string | null;
  conversation_history?: ConversationFragment[];
  history_mode?: "all" | "none";
}): AIContext {
  return buildContext({
    game_id: input.game_id,
    role_name: "accusation_start",
    session: input.session,
    blueprint: input.blueprint,
    accused_character: input.accused_character,
    player_input: input.player_input ?? null,
    conversation_history: input.conversation_history,
    accusation_history_mode: input.history_mode ?? "all",
  });
}

export function buildAccusationJudgeContext(input: {
  game_id: string;
  session: SessionSnapshot;
  blueprint: BlueprintContext;
  accused_character: string;
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
    accused_character: input.accused_character,
    player_input: input.player_input,
    conversation_history: input.conversation_history,
    accusation_history_mode: input.history_mode ?? "all",
    include_ground_truth: true,
  });
}

export function assertRoleContextSafety(
  role: AIRoleName,
  context: AIContext,
): void {
  if (role === "accusation_judge") {
    if (!context.ground_truth_context) {
      throw new Error(
        "Invalid context: accusation_judge requires ground truth context",
      );
    }
    return;
  }

  if (context.ground_truth_context) {
    throw new Error(
      `Invalid context: ${role} is not allowed to include ground truth context`,
    );
  }
}
