/**
 * One schema per part of the truth set. `evaluation/truth/README.md` says what
 * each part is for; this file is the exact shape of each.
 *
 * | Part                     | File                                  | Schema |
 * | ------------------------ | ------------------------------------- | ------ |
 * | Base blueprints          | `bases/<base>/blueprint.json`, `brief.json` | Blueprint V2, the story brief |
 * | Stored games             | `games/<game>/trace.json`             | `StoredGameSchema` |
 * | Labels                   | `games/<game>/labels.json`            | `LabelFileSchema` |
 * | Planted turn faults      | `plants/turns/<variant>.json`         | `TurnVariantSchema` |
 * | Planted blueprint faults | `plants/blueprints/<plant>.json`      | `BlueprintPlantSchema` |
 * | Stored results           | `results/<name>.json`                 | `StoredResultsSchema` |
 *
 * A part's id is its file or folder name, never repeated inside the file, so
 * the two cannot disagree. What a schema cannot see, such as a label on a turn
 * the game does not have, the loader checks.
 */

import { z } from "zod";

import { StatusSchema } from "../../core/result.ts";
import { TRACE_SCHEMA_VERSION } from "../../trace/lib/normalize.ts";
import { BlueprintKindSchema, GameKindSchema, isKindOf, SeveritySchema } from "./kinds.ts";

/** The id of a base, game, variant, plant or results file: its file or folder name. */
export const TRUTH_ID = /^[a-z0-9][a-z0-9-]*$/;
const IdSchema = z.string().regex(TRUTH_ID, "an id is lower-case letters, digits and hyphens");

const SequenceSchema = z.number().int().nonnegative();
const NoteSchema = z.string().trim().min(1);

// ---------------------------------------------------------------------------
// Stored games: the trace `judge game` reads (`evaluation/trace/README.md`).

const StoredEventSchema = z
  .object({
    id: z.string().nullable(),
    sequence: SequenceSchema,
    event_type: z.string().min(1),
    actor: z.string(),
    payload: z.record(z.unknown()).nullable(),
    narration: z.string(),
    narration_parts: z.array(z.unknown()),
    clues_revealed: z.array(z.string()),
    model: z.string().nullable(),
    created_at: z.string().nullable(),
  })
  .strict();

export const StoredGameSchema = z
  .object({
    schema_version: z.literal(TRACE_SCHEMA_VERSION),
    extracted_at: z.string(),
    source: z.object({ kind: z.string() }).passthrough(),
    session: z.object({ id: z.string().min(1), blueprint_id: z.string().min(1), mode: z.string() }).passthrough(),
    ai_profile: z.record(z.unknown()).nullable(),
    blueprint: z.object({ world: z.object({}).passthrough() }).passthrough(),
    events: z.array(StoredEventSchema).min(1),
  })
  .strict()
  .superRefine((game, ctx) => {
    const seen = new Set<number>();
    game.events.forEach((event, index) => {
      if (seen.has(event.sequence)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["events", index, "sequence"], message: `sequence ${event.sequence} repeats` });
      }
      seen.add(event.sequence);
    });
  });
export type StoredGame = z.infer<typeof StoredGameSchema>;

// ---------------------------------------------------------------------------
// Labels: what a person found wrong in a turn, by kind. Never a verdict.

export const FaultSchema = z.object({ kind: GameKindSchema, severity: SeveritySchema, note: NoteSchema }).strict();
export type Fault = z.infer<typeof FaultSchema>;

export const LabelSchema = z
  .object({
    /** The turn: its event's sequence in the stored game. */
    sequence: SequenceSchema,
    /** Empty when the turn was looked at and is clean. */
    faults: z.array(FaultSchema),
    by: z.string().trim().min(1),
    at: z.string().datetime(),
    pass: z.union([z.literal(1), z.literal(2)]),
  })
  .strict();
export type Label = z.infer<typeof LabelSchema>;

/**
 * Labels are only ever appended. A turn labelled again keeps its earlier
 * labels; the one with the latest `at` is scored, so two labels of one turn may
 * not share a time.
 */
export const LabelFileSchema = z
  .object({ labels: z.array(LabelSchema) })
  .strict()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.labels.forEach((label, index) => {
      const key = `${label.sequence}@${Date.parse(label.at)}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["labels", index, "at"],
          message: `turn ${label.sequence} already has a label at ${label.at}`,
        });
      }
      seen.add(key);
    });
  });
export type LabelFile = z.infer<typeof LabelFileSchema>;

// ---------------------------------------------------------------------------
// Edits, written as JSON Patch (RFC 6902) operations on a JSON pointer.

const PointerSchema = z.string().regex(/^(\/([^~/]|~[01])*)+$/, "a JSON pointer below the root, such as /world/characters/0/location_id");

export const PatchOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("test"), path: PointerSchema, value: z.unknown() }).strict(),
  z.object({ op: z.literal("replace"), path: PointerSchema, value: z.unknown() }).strict(),
  z.object({ op: z.literal("add"), path: PointerSchema, value: z.unknown() }).strict(),
  z.object({ op: z.literal("remove"), path: PointerSchema }).strict(),
]).superRefine((op, ctx) => {
  if (op.op !== "remove" && !("value" in op)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: `a ${op.op} operation needs a value` });
  }
});
export type PatchOp = z.infer<typeof PatchOpSchema>;

/** A patch starts with a `test` of what it changes, so it applies only to the subject it was written for. */
export const PatchSchema = z
  .array(PatchOpSchema)
  .min(1)
  .refine((ops) => ops[0]?.op === "test", { message: "a patch starts with a test of what it changes", path: [0, "op"] });

/**
 * An edit to one turn. `narration` replaces the one occurrence of `find` in
 * the event's `narration`, and in the text of each of its `narration_parts`
 * that holds `find`, so every reader of the turn sees the same words; `patch`
 * applies operations to the event itself, such as
 * `/payload/revealed_clue_ids`, to change what the turn recorded.
 */
export const TurnEditSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("narration"), find: z.string().min(1), replace: z.string() }).strict(),
  z.object({ type: z.literal("patch"), ops: PatchSchema }).strict(),
]);
export type TurnEdit = z.infer<typeof TurnEditSchema>;

// ---------------------------------------------------------------------------
// Planted turn faults: a variant of a stored game, carrying one or more.

/**
 * Which deterministic checks catch a plant: the ids of the checks that newly
 * report it, `[]` when none does. A plant carries the record, and the gate
 * holds it to what the checks report now. A plant a check catches needs no
 * judge to be found.
 */
const CaughtBySchema = z
  .array(z.string().min(1))
  .refine((ids) => new Set(ids).size === ids.length, { message: "a check is named once" });

export const TurnPlantSchema = z
  .object({
    sequence: SequenceSchema,
    kind: GameKindSchema,
    severity: SeveritySchema,
    note: NoteSchema,
    edits: z.array(TurnEditSchema).min(1),
    caught_by: CaughtBySchema,
  })
  .strict();
export type TurnPlant = z.infer<typeof TurnPlantSchema>;

export const TurnVariantSchema = z
  .object({
    /** The stored game the variant is built from. */
    game: IdSchema,
    /** At most one per turn, so each plant is the one fault known on its turn. */
    plants: z.array(TurnPlantSchema).min(1),
  })
  .strict()
  .superRefine((variant, ctx) => {
    const seen = new Set<number>();
    variant.plants.forEach((plant, index) => {
      if (seen.has(plant.sequence)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["plants", index, "sequence"], message: `turn ${plant.sequence} already has a plant` });
      }
      seen.add(plant.sequence);
    });
  });
export type TurnVariant = z.infer<typeof TurnVariantSchema>;

// ---------------------------------------------------------------------------
// Planted blueprint faults: a base and a small patch.

export const BlueprintPlantSchema = z
  .object({
    base: IdSchema,
    kind: BlueprintKindSchema,
    /** The blueprint judge the fault is meant for. */
    judge: z.string().min(1),
    note: NoteSchema,
    patch: PatchSchema,
    caught_by: CaughtBySchema,
  })
  .strict();
export type BlueprintPlant = z.infer<typeof BlueprintPlantSchema>;

// ---------------------------------------------------------------------------
// Stored results: per verdict, what scoring reads, and no prompt, log or workspace.

export const GameSubjectSchema = z
  .object({
    side: z.literal("game"),
    game: IdSchema,
    /** The planted variant judged; null for the stored game itself. */
    variant: IdSchema.nullable(),
    /** The one turn judged, for a judge of a turn; null for a judge of the whole game. */
    sequence: SequenceSchema.nullable(),
  })
  .strict();
export type GameSubject = z.infer<typeof GameSubjectSchema>;

export const BlueprintSubjectSchema = z
  .object({
    side: z.literal("blueprint"),
    base: IdSchema,
    /** The planted fault judged; null for the base itself. */
    plant: IdSchema.nullable(),
  })
  .strict();
export type BlueprintSubject = z.infer<typeof BlueprintSubjectSchema>;

export const StoredSubjectSchema = z.discriminatedUnion("side", [GameSubjectSchema, BlueprintSubjectSchema]);
export type StoredSubject = z.infer<typeof StoredSubjectSchema>;

export const StoredFindingSchema = z
  .object({
    /** The turn it points at; null when it points at no turn (a blueprint, or a finding that named none). */
    sequence: SequenceSchema.nullable(),
    /** The truth kinds it counts as, from the findings table. */
    kinds: z.array(z.string().min(1)).min(1),
    severity: SeveritySchema,
    /** The judge's own kind for it, when its answer gives one. */
    judge_kind: z.string().nullable(),
    /**
     * What the judge saw and why it counts, as its answer words them: the
     * quoted span, the reason, and the id or field it names. Null when the
     * answer has none, as for a stand-in finding of a bare `fail`, or a judge
     * whose answer lacks the field. A stored finding without them reads as null.
     */
    quote: z.string().nullable().default(null),
    why: z.string().nullable().default(null),
    refers_to: z.string().nullable().default(null),
  })
  .strict();
export type StoredFinding = z.infer<typeof StoredFindingSchema>;

export const StoredVerdictSchema = z
  .object({
    subject: StoredSubjectSchema,
    judge: z.string().min(1),
    /** The judge's version that reached it (`evaluation/core/judge-version.ts`). */
    judge_version: z.number().int().positive(),
    /** The hash of the subject it judged, as the truth set held it then (`subject-hash.ts`). */
    subject_hash: z.string().regex(/^[0-9a-f]{16}$/),
    model: z.string().min(1),
    /** Which run of the same judge on the same subject and model, from 0. */
    sample: z.number().int().nonnegative(),
    status: StatusSchema,
    findings: z.array(StoredFindingSchema),
    /** Null when unknown, as for a judge that never ran. */
    duration_ms: z.number().int().nonnegative().nullable(),
    /** What the CLI reported it cost, in US dollars; null when it reported nothing, never 0. */
    cost_usd: z.number().nonnegative().nullable(),
  })
  .strict()
  .superRefine((verdict, ctx) => {
    verdict.findings.forEach((finding, index) => {
      finding.kinds.forEach((kind, at) => {
        if (!isKindOf(verdict.subject.side, kind)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["findings", index, "kinds", at],
            message: `"${kind}" is not a ${verdict.subject.side} kind`,
          });
        }
      });
    });
  });
export type StoredVerdict = z.infer<typeof StoredVerdictSchema>;

export const STORED_RESULTS_VERSION = "mystery-truth-results/1";

/** One verdict per subject, judge, model and sample: a judge's new version replaces its old one. */
export function verdictKey(verdict: Pick<StoredVerdict, "subject" | "judge" | "model" | "sample">): string {
  return JSON.stringify([verdict.subject, verdict.judge, verdict.model, verdict.sample]);
}

export const StoredResultsSchema = z
  .object({ schema_version: z.literal(STORED_RESULTS_VERSION), verdicts: z.array(StoredVerdictSchema) })
  .strict()
  .superRefine((results, ctx) => {
    const seen = new Set<string>();
    results.verdicts.forEach((verdict, index) => {
      const key = verdictKey(verdict);
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["verdicts", index],
          message: `${verdict.judge} on this subject with ${verdict.model}, sample ${verdict.sample}, is already stored`,
        });
      }
      seen.add(key);
    });
  });
export type StoredResults = z.infer<typeof StoredResultsSchema>;

// ---------------------------------------------------------------------------

/** A truth-set file that does not match its schema, naming the file and each field. */
export class TruthFileError extends Error {
  constructor(file: string, detail: string) {
    super(`${file}: ${detail}`);
    this.name = "TruthFileError";
  }

  static fromZod(file: string, error: z.ZodError): TruthFileError {
    return new TruthFileError(file, error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; "));
  }
}

/** Parses `value` with `schema`, throwing a `TruthFileError` that names `file` and the field. */
export function parseTruthFile<T extends z.ZodTypeAny>(schema: T, value: unknown, file: string): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw TruthFileError.fromZod(file, parsed.error);
  return parsed.data;
}
