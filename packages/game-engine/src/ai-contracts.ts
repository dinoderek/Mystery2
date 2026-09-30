import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export type AIRoleName =
  | "talk_start"
  | "talk_conversation"
  | "talk_end"
  | "search"
  | "accusation_start"
  | "accusation_judge";

// Prompt templates are keyed per concrete prompt. The "search" ROLE (output
// contract) stays, but it has no template of its own: the handler always picks
// the "search_bare" or "search_targeted" prompt.
export type AIPromptKey =
  | Exclude<AIRoleName, "search">
  | "search_bare"
  | "search_targeted";

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
}

export interface AccusationJudgeOutput {
  narration: string;
  accusation_resolution: AccusationResolution;
}

// Each role's output contract is one Zod schema doing two jobs:
//
//   - Parsing. The `parse*Output` functions validate what the model returned
//     and normalise it. They forgive noise a model produces (junk entries in
//     an id list are dropped, a missing flag takes its default) and reject what
//     the game cannot do without (no narration, an unknown resolution).
//   - Asking. `roleOutputJsonSchema` turns the same schema into the JSON Schema
//     a provider hands the model, so what we ask for and what we accept cannot
//     drift apart. The forgiving steps are `z.preprocess`, which the conversion
//     looks through, so the model is asked for the clean shape.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roleObject<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape, {
    required_error: "expected object",
    invalid_type_error: "expected object",
  });
}

function nonEmptyString(field: string) {
  const message = `"${field}" must be a non-empty string`;
  return z
    .string({ required_error: message, invalid_type_error: message })
    .trim()
    .min(1, message);
}

// Required in the schema, so the model always states it; an omitted value
// still parses as null.
function nullableNonEmptyString(field: string) {
  const message = `"${field}" must be a non-empty string or null`;
  return z.preprocess(
    (value) => (value === undefined ? null : value),
    z.string({ invalid_type_error: message }).trim().min(1, message).nullable(),
  );
}

// A flag the model should always state; anything but a boolean falls back.
function flagDefaultingTo(fallback: boolean) {
  return z.preprocess(
    (value) => (typeof value === "boolean" ? value : fallback),
    z.boolean(),
  );
}

// A list of ids the model should always state; a missing list is empty and
// entries that are not non-empty strings are dropped.
const idList = z.preprocess(
  (value) =>
    Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [],
  z.array(z.string().min(1)),
);

const TalkStartOutputSchema = roleObject({
  narration: nonEmptyString("narration"),
});

const TalkConversationOutputSchema = roleObject({
  narration: nonEmptyString("narration"),
  revealed_clue_ids: idList,
  revealed_off_script: idList,
  input_understood: flagDefaultingTo(true),
}).transform((output): TalkConversationOutput => {
  // An unintelligible turn never reveals clues, regardless of what the model put
  // in revealed_clue_ids.
  const revealedClueIds = output.input_understood ? output.revealed_clue_ids : [];
  const revealedSet = new Set(revealedClueIds);
  return {
    narration: output.narration,
    revealed_clue_ids: revealedClueIds,
    // Off-script ids must be a subset of what was actually revealed this turn.
    revealed_off_script: output.revealed_off_script.filter((id) =>
      revealedSet.has(id)
    ),
    input_understood: output.input_understood,
  };
});

const TalkEndOutputSchema = roleObject({
  narration: nonEmptyString("narration"),
});

const SearchOutputSchema = z.preprocess(
  // An unintelligible search reveals nothing, so whatever the model put in
  // revealed_clue_id is not held against it.
  (value) =>
    isRecord(value) && value.input_understood === false
      ? { ...value, revealed_clue_id: null }
      : value,
  roleObject({
    narration: nonEmptyString("narration"),
    revealed_clue_id: nullableNonEmptyString("revealed_clue_id"),
    costs_turn: flagDefaultingTo(true),
    input_understood: flagDefaultingTo(true),
  }).transform((output): SearchOutput => ({
    ...output,
    // An unintelligible search never charges a turn.
    costs_turn: output.input_understood ? output.costs_turn : false,
  })),
);

const AccusationStartOutputSchema = roleObject({
  narration: nonEmptyString("narration"),
});

const ACCUSATION_RESOLUTION_MESSAGE =
  `"accusation_resolution" must be win, lose, or continue`;

const AccusationJudgeOutputSchema = roleObject({
  narration: nonEmptyString("narration"),
  accusation_resolution: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.enum(["win", "lose", "continue"], {
      errorMap: () => ({ message: ACCUSATION_RESOLUTION_MESSAGE }),
    }),
  ),
});

const ROLE_OUTPUT_SCHEMAS = {
  talk_start: TalkStartOutputSchema,
  talk_conversation: TalkConversationOutputSchema,
  talk_end: TalkEndOutputSchema,
  search: SearchOutputSchema,
  accusation_start: AccusationStartOutputSchema,
  accusation_judge: AccusationJudgeOutputSchema,
} satisfies Record<AIRoleName, z.ZodTypeAny>;

function parseRoleOutput<S extends z.ZodTypeAny>(
  role: AIRoleName,
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const reason = result.error.issues[0]?.message ?? "does not match the contract";
    throw new Error(`Invalid AI ${role} output: ${reason}`);
  }
  return result.data;
}

/**
 * The JSON Schema of what a role asks the model to return, for providers that
 * can constrain output to a schema. Generated from the same Zod schema the
 * role's parser uses.
 *
 * Every field is required here, including the ones the parser defaults: the
 * conversion reads a field that tolerates omission as optional, but the model
 * should always state it. Rules the schema cannot express (a narration of only
 * spaces) stay with the parser.
 */
export function roleOutputJsonSchema(role: AIRoleName): Record<string, unknown> {
  const schema = zodToJsonSchema(ROLE_OUTPUT_SCHEMAS[role], {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  const properties = schema.properties as Record<string, unknown>;
  return { ...schema, required: Object.keys(properties) };
}

export function parseTalkStartOutput(value: unknown): TalkStartOutput {
  return parseRoleOutput("talk_start", TalkStartOutputSchema, value);
}

export function parseTalkConversationOutput(
  value: unknown,
): TalkConversationOutput {
  return parseRoleOutput("talk_conversation", TalkConversationOutputSchema, value);
}

export function parseTalkEndOutput(value: unknown): TalkEndOutput {
  return parseRoleOutput("talk_end", TalkEndOutputSchema, value);
}

export function parseSearchOutput(value: unknown): SearchOutput {
  return parseRoleOutput("search", SearchOutputSchema, value);
}

export function parseAccusationStartOutput(
  value: unknown,
): AccusationStartOutput {
  return parseRoleOutput("accusation_start", AccusationStartOutputSchema, value);
}

export function parseAccusationJudgeOutput(
  value: unknown,
): AccusationJudgeOutput {
  return parseRoleOutput("accusation_judge", AccusationJudgeOutputSchema, value);
}
