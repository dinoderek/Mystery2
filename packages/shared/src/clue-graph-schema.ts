import { z } from "zod";
import { MAX_TARGET_AGE, MIN_TARGET_AGE } from "./age-profile.ts";

/**
 * The clue graph case format: an opening, clues and conclusions, with the
 * people and places they belong to. A case holds facts, never the words a
 * child reads: the narrator writes those. The model is `docs/clue-graph.md`;
 * this file holds only its shape. References and the graph checks are in
 * `clue-graph-validator.ts`.
 */

/** The format a case file declares. Earlier formats are rejected, never read. */
export const CLUE_GRAPH_FORMAT = "clue-graph/2";

/**
 * Whether a parsed file claims to be a clue-graph case, of any format: the
 * readers send it to the validator, which rejects a format it does not read.
 */
export function isClueGraphFile(candidate: unknown): boolean {
  const format = (candidate as { format?: unknown } | null)?.format;
  return typeof format === "string" && format.startsWith("clue-graph/");
}

const text = z.string().trim().min(1);
const facts = (min = 1) => z.array(text).min(min);
// IDs are not normalized: changing a map key would break its references.
const id = z
  .string()
  .min(1)
  .regex(/\S/, "ID must not be blank")
  .refine((value) => value !== "__proto__", "ID __proto__ is reserved");
/** What an asked clue may name as its prompt besides a clue: the opening. */
export const OPENING_PROMPT = "opening";

function ids(min = 0) {
  return z
    .array(id)
    .min(min)
    .superRefine((values, ctx) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index],
            message: `Duplicate reference "${value}"`,
          });
        seen.add(value);
      });
    });
}

function idMap<T extends z.ZodTypeAny>(value: T) {
  return z
    .record(id, value)
    .refine((map) => Object.keys(map).length > 0, "Must not be empty");
}

/**
 * How many first words a greeting, and each later line, hands out: a play
 * rule the route check and the engine share.
 */
export const FIRST_WORDS_PER_LINE = 3;

export const STANCES = [
  "open",
  "guarded",
  "shaken",
  "cornered",
  "cleared",
] as const;
export type Stance = (typeof STANCES)[number];

const SpotSchema = z
  .object({
    name: text,
    /** A hidden spot: unmentioned and unsearchable until this clue is held. */
    revealed_by: id.optional(),
  })
  .strict();

const LocationSchema = z
  .object({
    name: text,
    /** What is true of the place, for the narrator to describe. */
    facts: facts(),
    spots: z.array(SpotSchema),
  })
  .strict();

const DemeanorSchema = z
  .object(
    Object.fromEntries(STANCES.map((stance) => [stance, text.optional()])) as {
      [S in Stance]: z.ZodOptional<typeof text>;
    },
  )
  .strict()
  .refine(
    (demeanor) => Object.values(demeanor).some(Boolean),
    "At least one stance needs a demeanor line",
  );

/** A plain true fact a character shares when asked; never a clue. It may point at a place or a person. */
const KnowsSchema = z
  .object({
    fact: text,
    points_at: z
      .union([
        z.object({ location: id }).strict(),
        z.object({ character: id }).strict(),
      ])
      .optional(),
  })
  .strict();

const CharacterSchema = z
  .object({
    name: text,
    location: id,
    role: z.enum(["culprit", "suspect", "witness"]),
    /** Picks the narrator's pronouns, which are never guessed from a name. */
    sex: z.enum(["male", "female"]),
    /** Direction for the narrator, as are the demeanor lines: not text for the child. */
    personality: text,
    demeanor: DemeanorSchema,
    knows: z.array(KnowsSchema),
    /** What the character looks like, for the narrator and the artwork. */
    appearance: facts(2),
  })
  .strict();

const UseSchema = z.union([
  z.object({ any: ids(1) }).strict(),
  z.object({ all: ids(1) }).strict(),
]);

const GateSchema = z
  .object({
    /** Earlier clues from the same character that must be out first. */
    after: ids(1).optional(),
    /** Clues the player shows this character. */
    use: UseSchema.optional(),
    /** A line of questioning in words, with the tell that hints at it. */
    line: z
      .object({ text, hinted_by: id.optional() })
      .strict()
      .optional(),
    /** True when the gate cannot be bluffed. */
    physical: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (gate) => gate.after ?? gate.use ?? gate.line,
    "A gate needs after, use or line",
  );

const FirstMeeting = z.object({ by: z.literal("first_meeting") }).strict();
const Asked = z
  .object({
    by: z.literal("asked"),
    about: text,
    prompted_by: ids(),
  })
  .strict();
const Gated = z.object({ by: z.literal("gated"), gate: GateSchema }).strict();
/** A tell seen with one of the character's own statements, or on a subject. */
const Seen = z
  .object({ by: z.literal("seen"), with: id.optional(), subject: text.optional() })
  .strict();

const EvidenceSchema = z
  .object({
    kind: z.literal("evidence"),
    /** What the finding establishes, stated plainly and completely. */
    fact: text,
    source: z.object({ location: id, spot: text.optional() }).strict(),
  })
  .strict();

const characterSource = z.object({ character: id }).strict();

const StatementSchema = z
  .object({
    kind: z.literal("statement"),
    /** What the character claims, true or not. */
    fact: text,
    source: characterSource,
    truth: z.boolean(),
    why: text.optional(),
    reached: z.discriminatedUnion("by", [FirstMeeting, Asked, Gated]),
    takes_back: ids(1).optional(),
  })
  .strict();

const TellSchema = z
  .object({
    kind: z.literal("tell"),
    /** What is observed. */
    fact: text,
    source: characterSource,
    reached: z.discriminatedUnion("by", [FirstMeeting, Seen]),
  })
  .strict();

type Issue = { path: (string | number)[]; message: string };

function clueIssues(clue: z.infer<typeof StatementSchema> | z.infer<typeof TellSchema>): Issue[] {
  if (clue.kind === "tell") {
    const { reached } = clue;
    if (reached.by === "seen" && Boolean(reached.with) === Boolean(reached.subject))
      return [{ path: ["reached"], message: "A seen tell names one statement (with) or one subject" }];
    return [];
  }
  const issues: Issue[] = [];
  if (!clue.truth && !clue.why)
    issues.push({ path: ["why"], message: "A false statement says why it is false" });
  if (clue.truth && clue.why)
    issues.push({ path: ["why"], message: "Only a false statement carries why" });
  if (clue.takes_back && clue.reached.by !== "gated")
    issues.push({ path: ["takes_back"], message: "Only a gated statement takes back earlier statements" });
  return issues;
}

export const ClueGraphClueSchema = z
  .discriminatedUnion("kind", [EvidenceSchema, StatementSchema, TellSchema])
  .superRefine((clue, ctx) => {
    if (clue.kind === "evidence") return;
    for (const issue of clueIssues(clue))
      ctx.addIssue({ code: z.ZodIssueCode.custom, ...issue });
  });

export type ClueGraphRule = string | { all: ClueGraphRule[] } | { any: ClueGraphRule[] };
export const ClueGraphRuleSchema: z.ZodType<ClueGraphRule> = z.lazy(() =>
  z.union([
    id,
    z.object({ all: z.array(ClueGraphRuleSchema).min(1) }).strict(),
    z.object({ any: z.array(ClueGraphRuleSchema).min(1) }).strict(),
  ]),
);

const ConclusionSchema = z
  .object({
    text,
    rule: ClueGraphRuleSchema,
    clears: id.optional(),
    culprit: id.optional(),
    resolves: text.optional(),
  })
  .strict()
  .refine(
    (conclusion) =>
      [conclusion.clears, conclusion.culprit, conclusion.resolves].filter(
        Boolean,
      ).length <= 1,
    "A conclusion clears, names the culprit or resolves, at most one",
  );

/** Direction for generated images, the shape V2's `metadata.visual_direction` has. */
const VisualDirectionSchema = z
  .object({
    art_style: text,
    color_palette: text,
    mood: text,
    lighting: text,
    texture: text.optional(),
    /** Portraits only: an abstract backdrop that names no place in the case. */
    portrait_background: text.optional(),
  })
  .strict();

/** What the cover shows: facts, and the places and people it features. */
const CoverSchema = z
  .object({
    facts: facts(),
    locations: ids().optional(),
    characters: ids().optional(),
  })
  .strict();

const FormatSchema = z.literal(CLUE_GRAPH_FORMAT, {
  errorMap: (_issue, ctx) => ({
    message: `Format ${JSON.stringify(ctx.data)} is not read: a case file is "${CLUE_GRAPH_FORMAT}"`,
  }),
});

export const ClueGraphCaseSchema = z
  .object({
    format: FormatSchema,
    metadata: z
      .object({
        id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Must be kebab-case"),
        title: text,
        target_age: z.number().int().min(MIN_TARGET_AGE).max(MAX_TARGET_AGE),
        time_budget: z.number().int().positive().safe(),
      })
      .strict(),
    /** The public facts at the start. */
    opening: z.object({ location: id, facts: facts() }).strict(),
    /** What the ending tells: the timeline, and why the culprit did it. */
    truth: z.object({ timeline: facts(), motive: text }).strict(),
    locations: idMap(LocationSchema),
    characters: idMap(CharacterSchema),
    clues: idMap(ClueGraphClueSchema).refine(
      (clues) => !(OPENING_PROMPT in clues),
      `Clue ID "${OPENING_PROMPT}" is reserved for the opening`,
    ),
    conclusions: idMap(ConclusionSchema),
    visual_direction: VisualDirectionSchema.optional(),
    cover: CoverSchema.optional(),
  })
  .strict();

export type ClueGraphCase = z.infer<typeof ClueGraphCaseSchema>;
export type ClueGraphClue = z.infer<typeof ClueGraphClueSchema>;
export type ClueGraphStatement = z.infer<typeof StatementSchema>;
export type ClueGraphTell = z.infer<typeof TellSchema>;
export type ClueGraphEvidence = z.infer<typeof EvidenceSchema>;
export type ClueGraphGate = z.infer<typeof GateSchema>;
export type ClueGraphConclusion = z.infer<typeof ConclusionSchema>;
export type ClueGraphKnows = z.infer<typeof KnowsSchema>;
