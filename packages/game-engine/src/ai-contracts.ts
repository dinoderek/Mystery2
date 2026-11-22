import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export type AIRoleName =
  | "talk_start"
  | "talk_conversation"
  | "talk_end"
  | "search"
  | "accusation_start"
  | "accusation_judge"
  | "graph_talk"
  // A clue-graph search: the "search" contract, plus a notebook line.
  | "graph_search"
  // A clue-graph accusation round: who was named and what was cited, then the
  // narration of what the engine decided, before or at the end of the case.
  | "graph_accusation"
  | "graph_accusation_round"
  | "graph_ending";

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
  // Gate clues the player used on the character this turn (showing the clue, or
  // making its point at them), and the player's words that used them. The
  // engine keeps only the character's gate clues that the player holds, or a
  // bluff backed by the quote (`character-state.ts`).
  used_clue_ids: string[];
  used_quote: string | null;
  // Denials or claims the character newly made this turn, each short and in
  // their own terms ("never owned snowshoes").
  new_commitments: string[];
}

// The narrator's notebook line for one clue a clue-graph turn brings out. The
// engine saves it with the event; a turn whose lines are not exactly its clues
// fails before anything is saved (`turn/resolve-clue-graph.ts`).
export interface NotebookLine {
  id: string;
  line: string;
}

// One clue-graph talk line, greeting included (`docs/clue-graph.md`): the
// narration, the ids from the character's state the line earned, and a
// notebook line for every clue that comes out. The engine keeps only what the
// state offered and refuses the rest.
export interface GraphTalkOutput {
  narration: string;
  // Gates the line opened.
  opened: string[];
  // Questions it answered, and subject tells it brought out.
  answered: string[];
  notebook: NotebookLine[];
  // False for gibberish: an in-character "what?", and nothing earned.
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

// A clue-graph search: the search contract, with the found clue's notebook line.
export interface GraphSearchOutput extends SearchOutput {
  notebook: NotebookLine[];
}

export interface AccusationStartOutput {
  narration: string;
}

export interface AccusationJudgeOutput {
  narration: string;
  accusation_resolution: AccusationResolution;
}

// What the narrator reads from a clue-graph accusation: the character named,
// or null, and the held clues the investigator cited. No narration: the engine
// decides the round (`clue-graph/accusation.ts`), and another call words it.
export interface GraphAccusationOutput {
  accused_character_id: string | null;
  cited_clue_ids: string[];
}

// The narration of a clue-graph accusation round, or of its closing scene.
export interface GraphVerdictOutput {
  narration: string;
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

// What the player reads. A model sometimes escapes the quotes inside its
// string twice, which would show the player a literal backslash before each.
function narrationText() {
  return z.preprocess(
    (value) => (typeof value === "string" ? value.replaceAll('\\"', '"') : value),
    nonEmptyString("narration"),
  );
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

// A list the model should always state, where a missing list is empty and junk
// entries are dropped, but anything other than a list is a broken shape.
function stringList(field: string) {
  const message = `"${field}" must be a list of strings`;
  return z.preprocess(
    (value) =>
      value === undefined || value === null
        ? []
        : Array.isArray(value)
        ? value
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
        : value,
    z.array(z.string().min(1), { invalid_type_error: message }),
  );
}

const TalkStartOutputSchema = roleObject({
  narration: narrationText(),
});

const TalkConversationOutputSchema = roleObject({
  narration: narrationText(),
  revealed_clue_ids: idList,
  revealed_off_script: idList,
  input_understood: flagDefaultingTo(true),
  used_clue_ids: stringList("used_clue_ids"),
  // A blank quote is no quote.
  used_quote: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? null : value),
    nullableNonEmptyString("used_quote"),
  ),
  new_commitments: stringList("new_commitments"),
}).transform((output): TalkConversationOutput => {
  // An unintelligible turn never reveals clues, uses one or commits to
  // anything, regardless of what the model put in those fields.
  const understood = output.input_understood;
  const revealedClueIds = understood ? output.revealed_clue_ids : [];
  const revealedSet = new Set(revealedClueIds);
  const usedClueIds = understood ? [...new Set(output.used_clue_ids)] : [];
  return {
    narration: output.narration,
    revealed_clue_ids: revealedClueIds,
    // Off-script ids must be a subset of what was actually revealed this turn.
    revealed_off_script: output.revealed_off_script.filter((id) =>
      revealedSet.has(id)
    ),
    input_understood: understood,
    used_clue_ids: usedClueIds,
    // A quote only backs a use; with no clue used there is nothing to quote.
    used_quote: usedClueIds.length > 0 ? output.used_quote : null,
    new_commitments: understood ? output.new_commitments : [],
  };
});

// Notebook lines the model should always state: a missing list is empty, but
// an entry without an id or a line breaks the turn, so a blank line is never
// saved.
const notebookLines = z.preprocess(
  (value) => (value === undefined || value === null ? [] : value),
  z.array(
    z.object({ id: nonEmptyString("notebook id"), line: nonEmptyString("notebook line") }),
    { invalid_type_error: `"notebook" must be a list of { id, line }` },
  ),
);

const GraphTalkOutputSchema = roleObject({
  narration: narrationText(),
  opened: idList,
  answered: idList,
  notebook: notebookLines,
  input_understood: flagDefaultingTo(true),
}).transform((output): GraphTalkOutput => ({
  ...output,
  // An unintelligible line earns nothing, whatever the model listed.
  opened: output.input_understood ? [...new Set(output.opened)] : [],
  answered: output.input_understood ? [...new Set(output.answered)] : [],
  notebook: output.input_understood ? output.notebook : [],
}));

const TalkEndOutputSchema = roleObject({
  narration: narrationText(),
});

const searchFields = {
  narration: narrationText(),
  revealed_clue_id: nullableNonEmptyString("revealed_clue_id"),
  costs_turn: flagDefaultingTo(true),
  input_understood: flagDefaultingTo(true),
};

const SearchOutputSchema = z.preprocess(
  // An unintelligible search reveals nothing, so whatever the model put in
  // revealed_clue_id is not held against it.
  (value) =>
    isRecord(value) && value.input_understood === false
      ? { ...value, revealed_clue_id: null }
      : value,
  roleObject(searchFields).transform((output): SearchOutput => ({
    ...output,
    // An unintelligible search never charges a turn.
    costs_turn: output.input_understood ? output.costs_turn : false,
  })),
);

const GraphSearchOutputSchema = z.preprocess(
  // An unintelligible search reveals nothing and writes nothing down.
  (value) =>
    isRecord(value) && value.input_understood === false
      ? { ...value, revealed_clue_id: null, notebook: [] }
      : value,
  roleObject({ ...searchFields, notebook: notebookLines }).transform((output): GraphSearchOutput => ({
    ...output,
    costs_turn: output.input_understood ? output.costs_turn : false,
  })),
);

const AccusationStartOutputSchema = roleObject({
  narration: narrationText(),
});

const ACCUSATION_RESOLUTION_MESSAGE =
  `"accusation_resolution" must be win, lose, or continue`;

const AccusationJudgeOutputSchema = roleObject({
  narration: narrationText(),
  accusation_resolution: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.enum(["win", "lose", "continue"], {
      errorMap: () => ({ message: ACCUSATION_RESOLUTION_MESSAGE }),
    }),
  ),
});

const GraphAccusationOutputSchema = roleObject({
  accused_character_id: nullableNonEmptyString("accused_character_id"),
  cited_clue_ids: idList,
}).transform((output): GraphAccusationOutput => ({ ...output, cited_clue_ids: [...new Set(output.cited_clue_ids)] }));

const GraphVerdictOutputSchema = roleObject({
  narration: narrationText(),
});

const ROLE_OUTPUT_SCHEMAS = {
  talk_start: TalkStartOutputSchema,
  talk_conversation: TalkConversationOutputSchema,
  talk_end: TalkEndOutputSchema,
  search: SearchOutputSchema,
  accusation_start: AccusationStartOutputSchema,
  accusation_judge: AccusationJudgeOutputSchema,
  graph_talk: GraphTalkOutputSchema,
  graph_search: GraphSearchOutputSchema,
  graph_accusation: GraphAccusationOutputSchema,
  graph_accusation_round: GraphVerdictOutputSchema,
  graph_ending: GraphVerdictOutputSchema,
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

export function parseGraphTalkOutput(value: unknown): GraphTalkOutput {
  return parseRoleOutput("graph_talk", GraphTalkOutputSchema, value);
}

export function parseTalkEndOutput(value: unknown): TalkEndOutput {
  return parseRoleOutput("talk_end", TalkEndOutputSchema, value);
}

export function parseSearchOutput(value: unknown): SearchOutput {
  return parseRoleOutput("search", SearchOutputSchema, value);
}

export function parseGraphSearchOutput(value: unknown): GraphSearchOutput {
  return parseRoleOutput("graph_search", GraphSearchOutputSchema, value);
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

export function parseGraphAccusationOutput(value: unknown): GraphAccusationOutput {
  return parseRoleOutput("graph_accusation", GraphAccusationOutputSchema, value);
}

export function parseGraphAccusationRoundOutput(value: unknown): GraphVerdictOutput {
  return parseRoleOutput("graph_accusation_round", GraphVerdictOutputSchema, value);
}

export function parseGraphEndingOutput(value: unknown): GraphVerdictOutput {
  return parseRoleOutput("graph_ending", GraphVerdictOutputSchema, value);
}
