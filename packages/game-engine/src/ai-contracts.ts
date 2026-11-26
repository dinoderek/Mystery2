import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export type AIRoleName =
  | "talk_end"
  | "accusation_start"
  | "graph_talk"
  // A search, with the found clue's notebook line.
  | "graph_search"
  // A clue-graph accusation: who was named and what was cited, then the
  // narration of what the engine decided, before or at the end of the case.
  | "graph_accusation"
  | "graph_accusation_round"
  | "graph_ending"
  // The menu: every listed case's line under its title, in one call.
  | "one_liner";

// Every role has one prompt template, keyed by its name.
export type AIPromptKey = AIRoleName;

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

// A search: what it found, with the found clue's notebook line.
export interface GraphSearchOutput {
  narration: string;
  revealed_clue_id: string | null;
  costs_turn: boolean;
  // False when a targeted search query was gibberish / unintelligible. The
  // narration is then an in-character "what?" beat; the backend reveals no clue
  // and charges no turn. Defaults to true when the model omits it.
  input_understood: boolean;
  notebook: NotebookLine[];
}

export interface AccusationStartOutput {
  narration: string;
}

// What the narrator reads from a clue-graph accusation: the character named,
// or null, and the held clues the investigator cited. No narration: the engine
// decides the accusation (`clue-graph/accusation.ts`), and another call words it.
export interface GraphAccusationOutput {
  accused_character_id: string | null;
  cited_clue_ids: string[];
}

// The narration of a failed clue-graph accusation, or of its closing scene.
export interface GraphVerdictOutput {
  narration: string;
}

// The menu's lines, one per listed case id.
export interface OneLinerOutput {
  lines: NotebookLine[];
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

const GraphAccusationOutputSchema = roleObject({
  accused_character_id: nullableNonEmptyString("accused_character_id"),
  cited_clue_ids: idList,
}).transform((output): GraphAccusationOutput => ({ ...output, cited_clue_ids: [...new Set(output.cited_clue_ids)] }));

const GraphVerdictOutputSchema = roleObject({
  narration: narrationText(),
});

const OneLinerOutputSchema = roleObject({
  lines: z.array(
    z.object({ id: nonEmptyString("case id"), line: narrationText() }),
    { required_error: `"lines" must be a list of { id, line }`, invalid_type_error: `"lines" must be a list of { id, line }` },
  ),
});

const ROLE_OUTPUT_SCHEMAS = {
  talk_end: TalkEndOutputSchema,
  accusation_start: AccusationStartOutputSchema,
  graph_talk: GraphTalkOutputSchema,
  graph_search: GraphSearchOutputSchema,
  graph_accusation: GraphAccusationOutputSchema,
  graph_accusation_round: GraphVerdictOutputSchema,
  graph_ending: GraphVerdictOutputSchema,
  one_liner: OneLinerOutputSchema,
} satisfies Record<AIRoleName, z.ZodTypeAny>;

function parseWithSchema<S extends z.ZodTypeAny>(
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

/** Dispatch on the requested contract, never on fields in an untrusted answer. */
export function parseRoleOutput(role: AIRoleName, value: unknown) {
  return parseWithSchema(role, ROLE_OUTPUT_SCHEMAS[role], value);
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

export function parseGraphTalkOutput(value: unknown): GraphTalkOutput {
  return parseWithSchema("graph_talk", GraphTalkOutputSchema, value);
}

export function parseTalkEndOutput(value: unknown): TalkEndOutput {
  return parseWithSchema("talk_end", TalkEndOutputSchema, value);
}

export function parseGraphSearchOutput(value: unknown): GraphSearchOutput {
  return parseWithSchema("graph_search", GraphSearchOutputSchema, value);
}

export function parseAccusationStartOutput(
  value: unknown,
): AccusationStartOutput {
  return parseWithSchema("accusation_start", AccusationStartOutputSchema, value);
}

export function parseGraphAccusationOutput(value: unknown): GraphAccusationOutput {
  return parseWithSchema("graph_accusation", GraphAccusationOutputSchema, value);
}

export function parseGraphAccusationRoundOutput(value: unknown): GraphVerdictOutput {
  return parseWithSchema("graph_accusation_round", GraphVerdictOutputSchema, value);
}

export function parseGraphEndingOutput(value: unknown): GraphVerdictOutput {
  return parseWithSchema("graph_ending", GraphVerdictOutputSchema, value);
}

/**
 * The menu's lines, by case id: exactly one for each case asked about. A line
 * for a case not asked about is dropped; a case left without one, or given two,
 * breaks the output, unretried, like any reply that fails its parser.
 */
export function parseOneLinerOutput(value: unknown, caseIds: readonly string[]): Map<string, string> {
  const { lines } = parseWithSchema("one_liner", OneLinerOutputSchema, value);
  const asked = new Set(caseIds);
  const byId = new Map<string, string>();
  for (const { id, line } of lines) {
    if (!asked.has(id)) continue;
    if (byId.has(id)) throw new Error(`Invalid AI one_liner output: two lines for case ${id}`);
    byId.set(id, line);
  }
  const missing = caseIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(`Invalid AI one_liner output: no line for case ${missing.join(", ")}`);
  }
  return byId;
}
