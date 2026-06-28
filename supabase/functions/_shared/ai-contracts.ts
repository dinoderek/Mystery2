export type AIRoleName =
  | "talk_start"
  | "talk_conversation"
  | "talk_end"
  | "search"
  | "accusation_start"
  | "accusation_judge";

export type AIPromptKey = AIRoleName | "search_bare" | "search_targeted";

export type AccusationResolution = "win" | "lose" | "continue";

export interface TalkStartOutput {
  narration: string;
}

export interface TalkConversationOutput {
  narration: string;
  revealed_clue_ids: string[];
  // Subset of revealed_clue_ids the narrator granted off-script — for a clever
  // question or convincing bluff — even though the clue's prerequisites were not
  // met. Recorded as a real discovery, flagged for the notebook. Always a subset
  // of revealed_clue_ids.
  revealed_off_script: string[];
  // False when the player's message was gibberish / unintelligible. The
  // narration is then an in-character "what?" beat and the backend suppresses
  // any clue reveal. Defaults to true when the model omits it.
  input_understood: boolean;
}

export interface TalkEndOutput {
  narration: string;
}

export interface SearchOutput {
  narration: string;
  revealed_clue_id: string | null;
  costs_turn: boolean;
  // False when a targeted search query was gibberish / unintelligible. The
  // narration is then an in-character "what?" beat; the backend reveals no clue
  // and charges no turn. Defaults to true when the model omits it.
  input_understood: boolean;
}

export interface AccusationStartOutput {
  narration: string;
  follow_up_prompt: string;
}

export interface AccusationJudgeOutput {
  narration: string;
  accusation_resolution: AccusationResolution;
  follow_up_prompt: string | null;
}

export type AIRoleOutput =
  | TalkStartOutput
  | TalkConversationOutput
  | TalkEndOutput
  | SearchOutput
  | AccusationStartOutput
  | AccusationJudgeOutput;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  value: Record<string, unknown>,
  field: string,
  role: AIRoleName,
): string {
  const parsed = value[field];
  if (typeof parsed !== "string" || parsed.trim().length === 0) {
    throw new Error(
      `Invalid AI ${role} output: "${field}" must be a non-empty string`,
    );
  }

  return parsed.trim();
}

function requireOptionalNullableString(
  value: Record<string, unknown>,
  field: string,
  role: AIRoleName,
): string | null {
  const parsed = value[field];
  if (parsed === undefined || parsed === null) {
    return null;
  }

  if (typeof parsed !== "string" || parsed.trim().length === 0) {
    throw new Error(
      `Invalid AI ${role} output: "${field}" must be a non-empty string or null`,
    );
  }

  return parsed.trim();
}

function readOptionalBoolean(
  value: Record<string, unknown>,
  field: string,
  fallback: boolean,
): boolean {
  const parsed = value[field];
  return typeof parsed === "boolean" ? parsed : fallback;
}

function requireRoleObject(value: unknown, role: AIRoleName): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Invalid AI ${role} output: expected object`);
  }

  return value;
}

export function parseTalkStartOutput(value: unknown): TalkStartOutput {
  const parsed = requireRoleObject(value, "talk_start");
  return { narration: requireString(parsed, "narration", "talk_start") };
}

export function parseTalkConversationOutput(
  value: unknown,
): TalkConversationOutput {
  const parsed = requireRoleObject(value, "talk_conversation");
  const inputUnderstood = readOptionalBoolean(parsed, "input_understood", true);
  const rawIds = parsed.revealed_clue_ids;
  // An unintelligible turn never reveals clues, regardless of what the model put
  // in revealed_clue_ids.
  const revealedClueIds: string[] =
    inputUnderstood && Array.isArray(rawIds)
      ? rawIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
  const revealedSet = new Set(revealedClueIds);
  const rawOffScript = parsed.revealed_off_script;
  // Off-script ids must be a subset of what was actually revealed this turn.
  const revealedOffScript: string[] = Array.isArray(rawOffScript)
    ? rawOffScript.filter(
        (id): id is string => typeof id === "string" && revealedSet.has(id),
      )
    : [];
  return {
    narration: requireString(parsed, "narration", "talk_conversation"),
    revealed_clue_ids: revealedClueIds,
    revealed_off_script: revealedOffScript,
    input_understood: inputUnderstood,
  };
}

export function parseTalkEndOutput(value: unknown): TalkEndOutput {
  const parsed = requireRoleObject(value, "talk_end");
  return { narration: requireString(parsed, "narration", "talk_end") };
}

export function parseSearchOutput(value: unknown): SearchOutput {
  const parsed = requireRoleObject(value, "search");
  const inputUnderstood = readOptionalBoolean(parsed, "input_understood", true);
  const revealedClueId = inputUnderstood
    ? requireOptionalNullableString(parsed, "revealed_clue_id", "search")
    : null;
  const costsTurn = parsed.costs_turn;
  return {
    narration: requireString(parsed, "narration", "search"),
    revealed_clue_id: revealedClueId,
    // An unintelligible search never charges a turn.
    costs_turn: !inputUnderstood
      ? false
      : typeof costsTurn === "boolean"
      ? costsTurn
      : true,
    input_understood: inputUnderstood,
  };
}

export function parseAccusationStartOutput(
  value: unknown,
): AccusationStartOutput {
  const parsed = requireRoleObject(value, "accusation_start");
  return {
    narration: requireString(parsed, "narration", "accusation_start"),
    follow_up_prompt: requireString(
      parsed,
      "follow_up_prompt",
      "accusation_start",
    ),
  };
}

export function parseAccusationJudgeOutput(
  value: unknown,
): AccusationJudgeOutput {
  const parsed = requireRoleObject(value, "accusation_judge");
  const narration = requireString(parsed, "narration", "accusation_judge");
  const resolution = requireString(
    parsed,
    "accusation_resolution",
    "accusation_judge",
  );

  if (resolution !== "win" && resolution !== "lose" && resolution !== "continue") {
    throw new Error(
      `Invalid AI accusation_judge output: "accusation_resolution" must be win, lose, or continue`,
    );
  }

  const followUpPrompt = requireOptionalNullableString(
    parsed,
    "follow_up_prompt",
    "accusation_judge",
  );

  if (resolution === "continue" && followUpPrompt === null) {
    throw new Error(
      `Invalid AI accusation_judge output: "follow_up_prompt" is required when resolution is continue`,
    );
  }

  return {
    narration,
    accusation_resolution: resolution,
    follow_up_prompt: followUpPrompt,
  };
}

export function parseRoleOutput(
  role: AIRoleName,
  value: unknown,
): AIRoleOutput {
  switch (role) {
    case "talk_start":
      return parseTalkStartOutput(value);
    case "talk_conversation":
      return parseTalkConversationOutput(value);
    case "talk_end":
      return parseTalkEndOutput(value);
    case "search":
      return parseSearchOutput(value);
    case "accusation_start":
      return parseAccusationStartOutput(value);
    case "accusation_judge":
      return parseAccusationJudgeOutput(value);
  }
}
