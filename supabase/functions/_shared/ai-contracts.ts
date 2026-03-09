export type AIRoleName =
  | "talk_start"
  | "talk_conversation"
  | "talk_end"
  | "search"
  | "accusation_start"
  | "accusation_judge";

export type AccusationResolution = "win" | "lose" | "continue";

export interface TalkStartOutput {
  narration: string;
}

export interface TalkConversationOutput {
  narration: string;
}

export interface TalkEndOutput {
  narration: string;
}

export interface SearchOutput {
  narration: string;
}

export interface AccusationStartOutput {
  narration: string;
  follow_up_prompt: string;
}

export interface AccusationJudgeOutput {
  narration: string;
  accusation_resolution: AccusationResolution;
  follow_up_prompt: string | null;
  inferred_accused_character: string | null;
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
  return {
    narration: requireString(parsed, "narration", "talk_conversation"),
  };
}

export function parseTalkEndOutput(value: unknown): TalkEndOutput {
  const parsed = requireRoleObject(value, "talk_end");
  return { narration: requireString(parsed, "narration", "talk_end") };
}

export function parseSearchOutput(value: unknown): SearchOutput {
  const parsed = requireRoleObject(value, "search");
  return { narration: requireString(parsed, "narration", "search") };
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
  const inferredAccusedCharacter = requireOptionalNullableString(
    parsed,
    "inferred_accused_character",
    "accusation_judge",
  );

  if (resolution === "continue" && followUpPrompt === null) {
    throw new Error(
      `Invalid AI accusation_judge output: "follow_up_prompt" is required when resolution is continue`,
    );
  }
  if (resolution !== "continue" && inferredAccusedCharacter === null) {
    throw new Error(
      `Invalid AI accusation_judge output: "inferred_accused_character" is required when resolution is win or lose`,
    );
  }

  return {
    narration,
    accusation_resolution: resolution,
    follow_up_prompt: followUpPrompt,
    inferred_accused_character: inferredAccusedCharacter,
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
