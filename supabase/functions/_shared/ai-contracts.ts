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
}

export interface TalkEndOutput {
  narration: string;
}

export interface SearchOutput {
  narration: string;
  revealed_clue_id: string | null;
  costs_turn: boolean;
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
  const rawIds = parsed.revealed_clue_ids;
  const revealedClueIds: string[] =
    Array.isArray(rawIds)
      ? rawIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
  return {
    narration: requireString(parsed, "narration", "talk_conversation"),
    revealed_clue_ids: revealedClueIds,
  };
}

export function parseTalkEndOutput(value: unknown): TalkEndOutput {
  const parsed = requireRoleObject(value, "talk_end");
  return { narration: requireString(parsed, "narration", "talk_end") };
}

export function parseSearchOutput(value: unknown): SearchOutput {
  const parsed = requireRoleObject(value, "search");
  const revealedClueId = requireOptionalNullableString(
    parsed,
    "revealed_clue_id",
    "search",
  );
  const costsTurn = parsed.costs_turn;
  return {
    narration: requireString(parsed, "narration", "search"),
    revealed_clue_id: revealedClueId,
    costs_turn: typeof costsTurn === "boolean" ? costsTurn : true,
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
